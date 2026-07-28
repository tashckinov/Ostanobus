import { describe, expect, it } from 'vitest'

import { vehicleMotionAt } from './vehicle-motion'

describe('vehicleMotionAt', () => {
  const times = [600, 602, 604]
  const ratios = [0, 0.5, 1]

  it('удерживает автобус на остановке во время посадки', () => {
    expect(vehicleMotionAt(times, ratios, 600 + 5 / 60, 8)).toEqual({
      ratio: 0,
      status: 'boarding',
      stopIndex: 0,
      nextStopIndex: 1,
    })
  })

  it('двигает автобус после завершения стоянки', () => {
    const motion = vehicleMotionAt(times, ratios, 601, 8)
    expect(motion?.status).toBe('moving')
    expect(motion?.ratio).toBeGreaterThan(0)
    expect(motion?.ratio).toBeLessThan(0.5)
  })

  it('останавливает автобус на промежуточной остановке', () => {
    expect(vehicleMotionAt(times, ratios, 602 + 4 / 60, 8)).toEqual({
      ratio: 0.5,
      status: 'boarding',
      stopIndex: 1,
      nextStopIndex: 2,
    })
  })

  it('скрывает завершённый рейс после стоянки на конечной', () => {
    expect(vehicleMotionAt(times, ratios, 604 + 9 / 60, 8)).toBeNull()
  })
})
