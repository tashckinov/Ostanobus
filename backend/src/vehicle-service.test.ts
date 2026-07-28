import { describe, it, expect, beforeEach } from 'vitest'
import { DataSource } from 'typeorm'
import { VehicleService } from './vehicle-service.js'

import { createDataSource } from './data-source.js'
import { DirectionStop, SegmentStat, VehicleInstance } from './entities.js'

describe('VehicleService', () => {
  let dataSource: DataSource
  let service: VehicleService

  beforeEach(async () => {
    dataSource = createDataSource({
      sqlitePath: ':memory:',
      synchronize: true,
      dropSchema: true,
    })
    await dataSource.initialize()
    service = new VehicleService(dataSource)
  })

  it('1. creates predicted vehicle by schedule', async () => {
    const vehicle = await service.processObservation(
      'trip-1',
      'route-1',
      'dir-1',
      'stop-1',
      'device-1',
      'delay_report',
    )
    expect(vehicle).not.toBeNull()
    expect(vehicle?.state).toBe('predicted')
    expect(vehicle?.confidence).toBe('low')
    expect(vehicle?.confirmationCount).toBe(0)
  })

  it('2. first arrival confirmation changes state to observed', async () => {
    const now = new Date()
    const vehicle = await service.processObservation(
      'trip-1',
      'route-1',
      'dir-1',
      'stop-1',
      'device-1',
      'arrival_confirmation',
      null,
      now,
    )
    expect(vehicle?.state).toBe('observed')
    expect(vehicle?.lastConfirmedStopId).toBe('stop-1')
    expect(vehicle?.confirmationCount).toBe(1)
    expect(vehicle?.confidence).toBe('medium')
  })

  it('3. multiple independent devices increase confirmation badge', async () => {
    const now = new Date()
    await service.processObservation(
      'trip-1',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-1',
      'arrival_confirmation',
      null,
      now,
    )
    const v2 = await service.processObservation(
      'trip-1',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-2',
      'arrival_confirmation',
      null,
      now,
    )

    expect(v2?.confirmationCount).toBe(2)
    expect(v2?.confidence).toBe('high')
  })

  it('4. same device repeat does not increase badge', async () => {
    const now = new Date()
    await service.processObservation(
      'trip-1',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-1',
      'arrival_confirmation',
      null,
      now,
    )
    const v2 = await service.processObservation(
      'trip-1',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-1',
      'arrival_confirmation',
      null,
      new Date(now.getTime() + 1000),
    )

    expect(v2?.confirmationCount).toBe(1)
  })

  it('5. stale confirmations become unconfirmed/stale', async () => {
    const now = new Date()
    await service.processObservation(
      'trip-1',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-1',
      'arrival_confirmation',
      null,
      now,
    )

    // 6 minutes later
    const later = new Date(now.getTime() + 6 * 60 * 1000)
    const v2 = await service.recalculate('trip-1', later)

    expect(v2?.state).toBe('stale')
  })

  it('6. active vehicle reads recalculate stale state', async () => {
    const now = new Date('2026-07-28T10:00:00.000Z')
    await service.processObservation(
      '2026-07-28::route-1::dir-1::09:00',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-1',
      'arrival_confirmation',
      null,
      now,
    )

    const vehicles = await service.getActiveVehicles(new Date(now.getTime() + 6 * 60 * 1000))

    expect(vehicles).toHaveLength(1)
    expect(vehicles[0]?.state).toBe('stale')
  })

  it('7. uses the Moscow service date encoded in the trip id', async () => {
    const vehicle = await service.processObservation(
      '2026-07-29::route-1::dir-1::00:10',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-1',
      'arrival_confirmation',
      null,
      new Date('2026-07-28T21:10:00.000Z'),
    )

    expect(vehicle?.serviceDate).toBe('2026-07-29')
  })

  it('8. records travel time for an adjacent stop passage', async () => {
    await dataSource.getRepository(DirectionStop).save([
      { directionId: 'dir-1', stopId: 'stop-1', position: 0 },
      { directionId: 'dir-1', stopId: 'stop-2', position: 1 },
    ])
    const startedAt = new Date('2026-07-28T07:00:00.000Z')
    await service.processObservation(
      '2026-07-28::route-1::dir-1::10:00',
      'route-1',
      'dir-1',
      'stop-1',
      'dev-1',
      'arrival_confirmation',
      null,
      startedAt,
    )
    await service.processObservation(
      '2026-07-28::route-1::dir-1::10:00',
      'route-1',
      'dir-1',
      'stop-2',
      'dev-1',
      'stop_passage',
      null,
      new Date(startedAt.getTime() + 240_000),
    )

    const stat = await dataSource.getRepository(SegmentStat).findOneBy({
      routeId: 'route-1',
      directionId: 'dir-1',
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
    })
    const vehicle = await dataSource.getRepository(VehicleInstance).findOneBy({
      id: '2026-07-28::route-1::dir-1::10:00',
    })
    expect(stat).toMatchObject({
      medianSeconds: 240,
      p20Seconds: 240,
      p80Seconds: 240,
      sampleCount: 1,
      confidence: 'low',
    })
    expect(vehicle).toMatchObject({
      state: 'observed',
      lastConfirmedStopId: 'stop-2',
    })
  })
})
