import { type DataSource } from 'typeorm'
import { VehicleInstance, UserObservation } from './entities.js'
import { SegmentStatService } from './segment-stat-service.js'

const STALE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes without confirmation makes it stale

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
    observationType: 'delay_report' | 'arrival_confirmation',
    scheduledArrival: string | null = null,
    now = new Date()
  ): Promise<VehicleInstance | null> {
    const observationRepo = this.dataSource.getRepository(UserObservation)
    const vehicleRepo = this.dataSource.getRepository(VehicleInstance)

    // Save observation
    await observationRepo.save({
      id: `${vehicleInstanceId}-${stopId}-${deviceId}-${now.getTime()}`,
      observationType,
      vehicleInstanceId,
      routeId,
      directionId,
      stopId,
      deviceId,
      createdAt: now,
    })

    // Get or create vehicle instance
    let vehicle = await vehicleRepo.findOne({ where: { id: vehicleInstanceId } })
    if (!vehicle) {
      const today = now.toISOString().split('T')[0]!
      vehicle = vehicleRepo.create({
        id: vehicleInstanceId,
        routeId,
        directionId,
        serviceDate: today,
        state: 'predicted',
        confidence: 'low',
        confirmationCount: 0,
      })
    }

    // Only update position/state if it's an arrival confirmation
    if (observationType === 'arrival_confirmation') {
      vehicle.lastConfirmedStopId = stopId
      vehicle.lastConfirmedAt = now
      vehicle.state = 'observed'
      
      // Calculate confirmation count (distinct devices in last 5 minutes on this stop)
      const fiveMinsAgo = new Date(now.getTime() - STALE_TIMEOUT_MS)
      const recentConfirmations = await observationRepo.createQueryBuilder('obs')
        .select('obs.deviceId')
        .where('obs.vehicleInstanceId = :id', { id: vehicleInstanceId })
        .andWhere('obs.observationType = :type', { type: 'arrival_confirmation' })
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

      if (scheduledArrival) {
        const scheduledTime = new Date(scheduledArrival).getTime()
        if (!isNaN(scheduledTime)) {
          vehicle.delaySeconds = Math.round((now.getTime() - scheduledTime) / 1000)
        }
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
      const stop = await this.dataSource.getRepository(Stop).findOne({ where: { id: vehicle.lastConfirmedStopId }})
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
    const today = now.toISOString().split('T')[0]!
    
    const vehicles = await vehicleRepo.find({
      where: { serviceDate: today }
    })
    
    // Filter out finished or cancelled
    return vehicles.filter(v => v.state !== 'finished' && v.state !== 'cancelled')
  }
}
