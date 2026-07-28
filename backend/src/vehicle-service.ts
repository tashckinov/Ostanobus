import { In, type DataSource } from 'typeorm'
import { VehicleInstance, UserObservation } from './entities.js'
import { SegmentStatService } from './segment-stat-service.js'

const STALE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes without confirmation makes it stale
const CITY_TIME_ZONE = 'Europe/Moscow'

function serviceDateForVehicle(vehicleInstanceId: string, now: Date) {
  const tripDate = /^(\d{4}-\d{2}-\d{2})::/.exec(vehicleInstanceId)?.[1]
  if (tripDate) return tripDate
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CITY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

function cityHour(now: Date) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: CITY_TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  )
}

export class VehicleService {
  private segmentStatService: SegmentStatService

  constructor(private dataSource: DataSource) {
    this.segmentStatService = new SegmentStatService(dataSource)
  }

  async processObservation(
    vehicleInstanceId: string,
    routeId: string,
    directionId: string,
    stopId: string,
    deviceId: string,
    observationType: 'delay_report' | 'arrival_confirmation' | 'stop_passage',
    scheduledArrival: string | null = null,
    now = new Date(),
  ): Promise<VehicleInstance | null> {
    const observationRepo = this.dataSource.getRepository(UserObservation)
    const vehicleRepo = this.dataSource.getRepository(VehicleInstance)
    const previousObservation =
      observationType === 'arrival_confirmation' || observationType === 'stop_passage'
        ? await observationRepo.findOne({
            where: {
              vehicleInstanceId,
              deviceId,
              observationType: In(['arrival_confirmation', 'stop_passage']),
            },
            order: { createdAt: 'DESC' },
          })
        : null

    // Find existing or create new observation
    let observation = await observationRepo.findOne({
      where: {
        vehicleInstanceId,
        stopId,
        deviceId,
      },
    })

    if (!observation) {
      observation = observationRepo.create({
        id: `${vehicleInstanceId}-${stopId}-${deviceId}`,
        vehicleInstanceId,
        stopId,
        deviceId,
        routeId,
        directionId,
      })
    }

    observation.observationType = observationType
    observation.scheduledArrival = scheduledArrival ? new Date(scheduledArrival) : null
    observation.expiresAt = null
    observation.createdAt = now

    await observationRepo.save(observation)

    // Get or create vehicle instance
    let vehicle = await vehicleRepo.findOne({ where: { id: vehicleInstanceId } })
    if (!vehicle) {
      vehicle = vehicleRepo.create({
        id: vehicleInstanceId,
        routeId,
        directionId,
        serviceDate: serviceDateForVehicle(vehicleInstanceId, now),
        state: 'predicted',
        confidence: 'low',
        confirmationCount: 0,
      })
    }

    // Both boarding and a manual stop-passage mark confirm the same physical vehicle.
    if (observationType === 'arrival_confirmation' || observationType === 'stop_passage') {
      vehicle.lastConfirmedStopId = stopId
      vehicle.lastConfirmedAt = now
      vehicle.state = 'observed'

      // Calculate confirmation count (distinct devices in last 5 minutes on this stop)
      const fiveMinsAgo = new Date(now.getTime() - STALE_TIMEOUT_MS)
      const recentConfirmations = await observationRepo
        .createQueryBuilder('obs')
        .select('obs.deviceId')
        .where('obs.vehicleInstanceId = :id', { id: vehicleInstanceId })
        .andWhere('obs.observationType IN (:...types)', {
          types: ['arrival_confirmation', 'stop_passage'],
        })
        .andWhere('obs.createdAt > :time', { time: fiveMinsAgo })
        .andWhere('obs.stopId = :stopId', { stopId })
        .distinct(true)
        .getRawMany()

      vehicle.confirmationCount = recentConfirmations.length
      if (vehicle.confirmationCount > 1) {
        vehicle.confidence = 'high'
      } else {
        vehicle.confidence = 'medium'
      }

      if (
        previousObservation &&
        previousObservation.stopId !== stopId &&
        previousObservation.createdAt
      ) {
        await this.segmentStatService.recordTravelSample({
          vehicleInstanceId,
          deviceId,
          routeId,
          directionId,
          fromStopId: previousObservation.stopId,
          toStopId: stopId,
          departedAt: previousObservation.createdAt,
          arrivedAt: now,
        })
      }
    }

    if (scheduledArrival) {
      const scheduledTime = new Date(scheduledArrival).getTime()
      if (!isNaN(scheduledTime)) {
        vehicle.delaySeconds = Math.round((now.getTime() - scheduledTime) / 1000)
      }
    }

    await vehicleRepo.save(vehicle)
    return this.recalculate(vehicle.id, now)
  }

  async recalculate(vehicleId: string, now = new Date()): Promise<VehicleInstance | null> {
    const vehicleRepo = this.dataSource.getRepository(VehicleInstance)
    const vehicle = await vehicleRepo.findOne({ where: { id: vehicleId } })
    if (!vehicle) return null

    // Check if stale
    if (vehicle.state === 'observed' && vehicle.lastConfirmedAt) {
      const timeSinceConfirmation = now.getTime() - vehicle.lastConfirmedAt.getTime()
      if (timeSinceConfirmation > STALE_TIMEOUT_MS) {
        vehicle.state = 'stale'
      }
    }

    // Basic fallback: if we have lastConfirmedStopId, get its coordinates
    if (vehicle.lastConfirmedStopId && vehicle.lastConfirmedAt) {
      // Find the stop in the route
      const { Stop } = await import('./entities.js')
      const stop = await this.dataSource
        .getRepository(Stop)
        .findOne({ where: { id: vehicle.lastConfirmedStopId } })
      if (stop) {
        vehicle.positionLongitude = stop.longitude
        vehicle.positionLatitude = stop.latitude
      }
    } else {
      // For predicted vehicles, without full schedule interpolation on backend, we will just set it to null
      // and let the frontend keep animating predicted ones, OR we can let frontend handle all positions.
    }

    await vehicleRepo.save(vehicle)
    return vehicle
  }

  async getActiveVehicles(now = new Date()): Promise<VehicleInstance[]> {
    const vehicleRepo = this.dataSource.getRepository(VehicleInstance)
    const today = serviceDateForVehicle('', now)
    const yesterday = serviceDateForVehicle('', new Date(now.getTime() - 24 * 60 * 60 * 1_000))
    const serviceDates = cityHour(now) < 4 ? [today, yesterday] : [today]

    const vehicles = await vehicleRepo.find({
      where: { serviceDate: In(serviceDates) },
    })

    const recalculated = await Promise.all(
      vehicles.map((vehicle) => this.recalculate(vehicle.id, now)),
    )
    return recalculated.filter((vehicle): vehicle is VehicleInstance =>
      Boolean(vehicle && vehicle.state !== 'finished' && vehicle.state !== 'cancelled'),
    )
  }
}
