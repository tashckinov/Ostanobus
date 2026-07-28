import { type DataSource } from 'typeorm'
import { DelayReport, TripState, Confidence, TripStateStatus } from './entities.js'

export class TripStateService {
  constructor(private dataSource: DataSource) {}

  async recalculate(tripId: string, now = new Date()) {
    const reportRepository = this.dataSource.getRepository(DelayReport)
    const tripStateRepository = this.dataSource.getRepository(TripState)

    const reports = await reportRepository.find({
      where: { tripId },
      order: { createdAt: 'ASC' },
    })

    if (reports.length === 0) return null

    const firstReport = reports[0]!

    let status: TripStateStatus = 'possibly_delayed'
    let confidence: Confidence = 'low'
    
    const delays: number[] = []
    let earlyAmbiguity = false

    for (const report of reports) {
      // Allow up to 60 seconds grace period for opening the card
      const openedBefore = report.cardOpenedAt.getTime() <= report.scheduledArrival.getTime() + 60000
       
      if (!openedBefore) {
        earlyAmbiguity = true
      }

      const delaySeconds = (report.createdAt.getTime() - report.scheduledArrival.getTime()) / 1000
      delays.push(delaySeconds)
    }

    let minDelaySeconds: number | null = null
    let maxDelaySeconds: number | null = null
    let estimatedDelaySeconds = 0

    if (reports.length === 1) {
      if (earlyAmbiguity) {
        status = 'location_unknown'
        confidence = 'low'
      } else {
        status = 'possibly_delayed'
        confidence = 'low'
        estimatedDelaySeconds = delays[0]!
        minDelaySeconds = Math.max(0, estimatedDelaySeconds - 120)
        maxDelaySeconds = estimatedDelaySeconds + 300
      }
    } else {
      const lastDelay = delays[delays.length - 1]!
      estimatedDelaySeconds = lastDelay
      status = 'likely_delayed'
      confidence = 'medium'
       
      const uniqueDevices = new Set(reports.map(r => r.deviceId)).size
      if (uniqueDevices > 1 || reports.length > 2) {
        status = 'delayed'
        confidence = 'high'
      }
       
      if (earlyAmbiguity && uniqueDevices === 1) {
        status = 'possibly_delayed'
      }

      minDelaySeconds = Math.max(0, estimatedDelaySeconds - 60)
      maxDelaySeconds = estimatedDelaySeconds + 180
    }

    let tripState = await tripStateRepository.findOne({ where: { tripId } })
    if (!tripState) {
      tripState = new TripState()
      tripState.tripId = tripId
      tripState.routeId = firstReport.routeId
      tripState.directionId = firstReport.directionId
      tripState.serviceDate = firstReport.scheduledArrival.toISOString().split('T')[0]!
      tripState.scheduledTripStart = firstReport.scheduledArrival
    }

    tripState.delaySeconds = Math.max(0, Math.round(estimatedDelaySeconds))
    tripState.minDelaySeconds = minDelaySeconds !== null ? Math.max(0, Math.round(minDelaySeconds)) : null
    tripState.maxDelaySeconds = maxDelaySeconds !== null ? Math.max(0, Math.round(maxDelaySeconds)) : null
    tripState.confidence = confidence
    tripState.status = status
    tripState.lastCalculatedAt = now

    await tripStateRepository.save(tripState)
    return tripState
  }
}
