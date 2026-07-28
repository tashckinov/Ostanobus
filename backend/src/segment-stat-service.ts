import { randomUUID } from 'node:crypto'

import { type DataSource } from 'typeorm'

import { DirectionStop, SegmentStat, SegmentTravelSample } from './entities.js'

const CITY_TIME_ZONE = 'Europe/Moscow'
const MAX_SEGMENT_SECONDS = 2 * 60 * 60

function percentile(sorted: number[], fraction: number) {
  if (sorted.length === 1) return sorted[0]!
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]!
  return Math.round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower))
}

export class SegmentStatService {
  constructor(private dataSource: DataSource) {}

  async getSegmentTravelTime(
    routeId: string,
    directionId: string,
    fromStopId: string,
    toStopId: string,
    timeBucket: string,
  ): Promise<number | null> {
    const statRepository = this.dataSource.getRepository(SegmentStat)
    const stat = await statRepository.findOne({
      where: {
        routeId,
        directionId,
        fromStopId,
        toStopId,
        timeBucket,
      },
    })

    return stat ? stat.medianSeconds : null
  }

  async recordTravelSample(input: {
    vehicleInstanceId: string
    deviceId: string
    routeId: string
    directionId: string
    fromStopId: string
    toStopId: string
    departedAt: Date
    arrivedAt: Date
  }) {
    if (input.fromStopId === input.toStopId) return null

    const travelSeconds = Math.round(
      (input.arrivedAt.getTime() - input.departedAt.getTime()) / 1_000,
    )
    if (travelSeconds < 1 || travelSeconds > MAX_SEGMENT_SECONDS) return null

    const directionStops = await this.dataSource.getRepository(DirectionStop).find({
      where: { directionId: input.directionId },
      order: { position: 'ASC' },
    })
    const fromIndex = directionStops.findIndex((item) => item.stopId === input.fromStopId)
    const toIndex = directionStops.findIndex((item) => item.stopId === input.toStopId)
    if (fromIndex < 0 || toIndex !== fromIndex + 1) return null

    const sampleRepository = this.dataSource.getRepository(SegmentTravelSample)
    const existing = await sampleRepository.findOne({
      where: {
        vehicleInstanceId: input.vehicleInstanceId,
        deviceId: input.deviceId,
        fromStopId: input.fromStopId,
        toStopId: input.toStopId,
      },
    })
    const timeBucket = SegmentStatService.getTimeBucket(input.departedAt)
    await sampleRepository.save({
      id: existing?.id ?? randomUUID(),
      vehicleInstanceId: input.vehicleInstanceId,
      deviceId: input.deviceId,
      routeId: input.routeId,
      directionId: input.directionId,
      fromStopId: input.fromStopId,
      toStopId: input.toStopId,
      travelSeconds,
      timeBucket,
      observedAt: input.arrivedAt,
    })

    const samples = await sampleRepository.find({
      where: {
        routeId: input.routeId,
        directionId: input.directionId,
        fromStopId: input.fromStopId,
        toStopId: input.toStopId,
        timeBucket,
      },
    })
    const values = samples.map((sample) => sample.travelSeconds).sort((a, b) => a - b)
    const statRepository = this.dataSource.getRepository(SegmentStat)
    const existingStat = await statRepository.findOne({
      where: {
        routeId: input.routeId,
        directionId: input.directionId,
        fromStopId: input.fromStopId,
        toStopId: input.toStopId,
        timeBucket,
      },
    })
    return statRepository.save({
      ...(existingStat ?? {}),
      routeId: input.routeId,
      directionId: input.directionId,
      fromStopId: input.fromStopId,
      toStopId: input.toStopId,
      timeBucket,
      medianSeconds: percentile(values, 0.5),
      p20Seconds: percentile(values, 0.2),
      p80Seconds: percentile(values, 0.8),
      sampleCount: values.length,
      confidence: values.length >= 15 ? 'high' : values.length >= 5 ? 'medium' : 'low',
    })
  }

  static getTimeBucket(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CITY_TIME_ZONE,
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const weekday = parts.find((part) => part.type === 'weekday')?.value
    const hours = Number(parts.find((part) => part.type === 'hour')?.value)
    const isWeekend = weekday === 'Sat' || weekday === 'Sun'
    if (isWeekend) return 'weekend'
    if (hours >= 6 && hours < 10) return 'weekday_06_10'
    if (hours >= 10 && hours < 16) return 'weekday_10_16'
    if (hours >= 16 && hours < 20) return 'weekday_16_20'
    return 'weekday_20_24'
  }
}
