import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export type EventType = 'bus_arrival' | 'stop_passage'
export type ScheduleType = 'exact' | 'interval'
export type Confidence = 'high' | 'medium' | 'low'
export type TicketStatus = 'new' | 'in_progress' | 'resolved' | 'rejected'

export interface GeoJsonLineString {
  type: 'LineString'
  coordinates: number[][]
}

export type RoutingPoint =
  { type: 'stop'; stopId: string } | { type: 'via'; longitude: number; latitude: number }

@Entity('cities')
export class City {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  name!: string

  @Column('float')
  centerLongitude!: number

  @Column('float')
  centerLatitude!: number

  @Column({ type: 'boolean', default: true })
  active!: boolean
}

@Entity('stops')
@Index(['cityId', 'name'])
export class Stop {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  cityId!: string

  @Column('varchar')
  name!: string

  @Column('varchar')
  shortName!: string

  @Column('float')
  longitude!: number

  @Column('float')
  latitude!: number

  @Column({ type: 'varchar', nullable: true })
  osmId!: string | null

  @Column({ type: 'varchar', nullable: true })
  osmUrl!: string | null

  @Column({ type: 'boolean', default: true })
  active!: boolean

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date
}

@Entity('routes')
@Index(['cityId', 'number'], { unique: true })
export class Route {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  cityId!: string

  @Column('varchar')
  number!: string

  @Column({ type: 'varchar', nullable: true })
  name!: string | null

  @Column({ type: 'varchar', default: '#0074dc' })
  color!: string

  @Column({ type: 'boolean', default: true })
  active!: boolean

  @Column({ type: 'boolean', default: false })
  isMock!: boolean

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date
}

@Entity('directions')
export class Direction {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  routeId!: string

  @Column('varchar')
  name!: string

  @Column('varchar')
  terminal!: string

  @Column({ type: 'simple-json', nullable: true })
  geometry!: GeoJsonLineString | null

  @Column({ type: 'simple-json', default: '[]' })
  routingPoints!: RoutingPoint[]

  @Column({ type: 'integer', nullable: true })
  distanceMeters!: number | null

  @Column({ type: 'boolean', default: true })
  active!: boolean

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date
}

@Entity('direction_stops')
@Index(['directionId', 'position'], { unique: true })
@Index(['directionId', 'stopId'], { unique: true })
export class DirectionStop {
  @PrimaryGeneratedColumn('increment')
  id!: number

  @Column('varchar')
  directionId!: string

  @Column('varchar')
  stopId!: string

  @Column('integer')
  position!: number
}

@Entity('schedules')
@Index(['directionId', 'stopId'])
export class Schedule {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  directionId!: string

  @Column({ type: 'varchar', nullable: true })
  stopId!: string | null

  @Column({ type: 'simple-json' })
  days!: number[]

  @Column('varchar')
  type!: ScheduleType

  @Column({ type: 'varchar', nullable: true })
  departureTime!: string | null

  @Column({ type: 'varchar', nullable: true })
  startTime!: string | null

  @Column({ type: 'varchar', nullable: true })
  endTime!: string | null

  @Column({ type: 'integer', nullable: true })
  headwayMinutes!: number | null

  @Column({ type: 'boolean', default: true })
  active!: boolean
}

@Entity('forecasts')
@Index(['stopId', 'routeId', 'directionId'], { unique: true })
export class Forecast {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  stopId!: string

  @Column('varchar')
  routeId!: string

  @Column({ type: 'varchar', nullable: true })
  directionId!: string | null

  @Column('integer')
  minMinutes!: number

  @Column('integer')
  maxMinutes!: number

  @Column('varchar')
  confidence!: Confidence

  @Column({ type: 'integer', default: 0 })
  sampleSize!: number

  @Column({ type: 'boolean', default: true })
  active!: boolean

  @Column({ type: 'datetime' })
  calculatedAt!: Date
}

@Entity('events')
@Index(['receivedAt'])
@Index(['clientId'])
export class TransitEvent {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  clientId!: string

  @Column('varchar')
  type!: EventType

  @Column('varchar')
  routeId!: string

  @Column({ type: 'varchar', nullable: true })
  directionId!: string | null

  @Column('varchar')
  stopId!: string

  @Column({ type: 'datetime' })
  occurredAt!: Date

  @CreateDateColumn({ type: 'datetime' })
  receivedAt!: Date
}

@Entity('support_tickets')
@Index(['status', 'createdAt'])
export class SupportTicket {
  @PrimaryColumn('varchar')
  id!: string

  @Column('varchar')
  clientId!: string

  @Column('varchar')
  category!: string

  @Column('text')
  message!: string

  @Column({ type: 'varchar', nullable: true })
  stopId!: string | null

  @Column({ type: 'varchar', nullable: true })
  routeId!: string | null

  @Column({ type: 'varchar', default: 'new' })
  status!: TicketStatus

  @Column('text', { nullable: true })
  adminReply!: string | null

  @Column('varchar')
  publicTokenHash!: string

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date
}

@Entity('admins')
export class Admin {
  @PrimaryColumn('varchar')
  id!: string

  @Column({ type: 'varchar', unique: true })
  email!: string

  @Column('varchar')
  passwordHash!: string

  @Column({ type: 'boolean', default: true })
  active!: boolean

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date
}

export const entities = [
  City,
  Stop,
  Route,
  Direction,
  DirectionStop,
  Schedule,
  Forecast,
  TransitEvent,
  SupportTicket,
  Admin,
]
