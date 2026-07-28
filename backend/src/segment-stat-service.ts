import { type DataSource } from 'typeorm'
import { SegmentStat } from './entities.js'

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

  static getTimeBucket(date: Date): string {
    const isWeekend = date.getDay() === 0 || date.getDay() === 6
    if (isWeekend) return 'weekend'
    const hours = date.getHours()
    if (hours >= 6 && hours < 10) return 'weekday_06_10'
    if (hours >= 10 && hours < 16) return 'weekday_10_16'
    if (hours >= 16 && hours < 20) return 'weekday_16_20'
    return 'weekday_20_24'
  }
}
