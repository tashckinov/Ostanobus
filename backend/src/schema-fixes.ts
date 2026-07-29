import type { DataSource } from 'typeorm'

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

    if (
      names.length === 2 &&
      names.includes('directionId') &&
      names.includes('stopId')
    ) {
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
 * A route can legitimately visit the same physical stop more than once.
 * Direction stop identity is therefore determined by direction + position,
 * not by direction + stop.
 *
 * TypeORM still creates the legacy unique index from old installations during
 * synchronize. Remove it after initialization so existing databases migrate
 * without destructive table recreation.
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
