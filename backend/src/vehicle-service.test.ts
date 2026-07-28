import { describe, it, expect, beforeEach } from 'vitest'
import { DataSource } from 'typeorm'
import { VehicleService } from './vehicle-service.js'

import { createDataSource } from './data-source.js'

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
      'trip-1', 'route-1', 'dir-1', 'stop-1', 'device-1', 'delay_report'
    )
    expect(vehicle).not.toBeNull()
    expect(vehicle?.state).toBe('predicted')
    expect(vehicle?.confidence).toBe('low')
    expect(vehicle?.confirmationCount).toBe(0)
  })

  it('2. first arrival confirmation changes state to observed', async () => {
    const now = new Date()
    const vehicle = await service.processObservation(
      'trip-1', 'route-1', 'dir-1', 'stop-1', 'device-1', 'arrival_confirmation', null, now
    )
    expect(vehicle?.state).toBe('observed')
    expect(vehicle?.lastConfirmedStopId).toBe('stop-1')
    expect(vehicle?.confirmationCount).toBe(1)
    expect(vehicle?.confidence).toBe('medium')
  })

  it('3. multiple independent devices increase confirmation badge', async () => {
    const now = new Date()
    await service.processObservation('trip-1', 'route-1', 'dir-1', 'stop-1', 'dev-1', 'arrival_confirmation', null, now)
    const v2 = await service.processObservation('trip-1', 'route-1', 'dir-1', 'stop-1', 'dev-2', 'arrival_confirmation', null, now)
    
    expect(v2?.confirmationCount).toBe(2)
    expect(v2?.confidence).toBe('high')
  })

  it('4. same device repeat does not increase badge', async () => {
    const now = new Date()
    await service.processObservation('trip-1', 'route-1', 'dir-1', 'stop-1', 'dev-1', 'arrival_confirmation', null, now)
    const v2 = await service.processObservation('trip-1', 'route-1', 'dir-1', 'stop-1', 'dev-1', 'arrival_confirmation', null, new Date(now.getTime() + 1000))
    
    expect(v2?.confirmationCount).toBe(1)
  })

  it('5. stale confirmations become unconfirmed/stale', async () => {
    const now = new Date()
    await service.processObservation('trip-1', 'route-1', 'dir-1', 'stop-1', 'dev-1', 'arrival_confirmation', null, now)
    
    // 6 minutes later
    const later = new Date(now.getTime() + 6 * 60 * 1000)
    const v2 = await service.recalculate('trip-1', later)
    
    expect(v2?.state).toBe('stale')
  })

})
