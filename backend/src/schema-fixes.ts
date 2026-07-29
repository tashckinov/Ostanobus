import { getMetadataArgsStorage, type DataSource } from 'typeorm'

import { DirectionStop } from './entities.js'

type SqliteIndexRow = {
  name: string
  unique: number
}

type SqliteIndexColumnRow = {
  seqno: number
  name: string
}

type PostgresIndexRow = {
  indexname: string
  indexdef: string
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function isLegacyDirectionStopIndex(columns: string[]) {
  return (
    columns.length === 2 &&
    columns.includes('directionId') &&
    columns.includes('stopId')
  )
}

/**
 * Remove the legacy unique index from TypeORM decorator metadata before the
 * DataSource is initialized. Otherwise synchronize would recreate the index on
 * every restart and fail as soon as a route legitimately visits one stop more
 * than once.
 */
export function prepareRuntimeSchemaFixes() {
  const indices = getMetadataArgsStorage().indices

  for (let index = indices.length - 1; index >= 0; index -= 1) {
    const metadata = indices[index]
    if (
      !metadata ||
      metadata.target !== DirectionStop ||
      !metadata.unique ||
      !Array.isArray(metadata.columns)
    ) {
      continue
    }

    if (isLegacyDirectionStopIndex(metadata.columns)) {
      indices.splice(index, 1)
    }
  }
}

async function dropSqliteDirectionStopUniqueIndex(dataSource: DataSource) {
  const indexes = (await dataSource.query(
    'PRAGMA index_list("direction_stops")',
  )) as SqliteIndexRow[]

  for (const index of indexes) {
    if (!index.unique) continue

    const indexName = quoteIdentifier(index.name)
    const columns = (await dataSource.query(
      `PRAGMA index_info(${indexName})`,
    )) as SqliteIndexColumnRow[]
    const names = columns
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name)

    if (isLegacyDirectionStopIndex(names)) {
      await dataSource.query(`DROP INDEX IF EXISTS ${indexName}`)
    }
  }
}

async function dropPostgresDirectionStopUniqueIndex(dataSource: DataSource) {
  const indexes = (await dataSource.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'direction_stops'
  `)) as PostgresIndexRow[]

  for (const index of indexes) {
    const definition = index.indexdef.replaceAll(' ', '').toLowerCase()
    const isUnique = definition.includes('createuniqueindex')
    const hasDirectionId = definition.includes('"directionid"')
    const hasStopId = definition.includes('"stopid"')
    const hasPosition = definition.includes('"position"')

    if (isUnique && hasDirectionId && hasStopId && !hasPosition) {
      await dataSource.query(
        `DROP INDEX IF EXISTS ${quoteIdentifier(index.indexname)}`,
      )
    }
  }
}

/**
 * Drop the index from existing databases after initialization. Direction stop
 * identity is determined by direction + position, not by direction + stop.
 */
export async function applyRuntimeSchemaFixes(dataSource: DataSource) {
  if (
    dataSource.options.type === 'better-sqlite3' ||
    dataSource.options.type === 'sqlite'
  ) {
    await dropSqliteDirectionStopUniqueIndex(dataSource)
    return
  }

  if (dataSource.options.type === 'postgres') {
    await dropPostgresDirectionStopUniqueIndex(dataSource)
  }
}
