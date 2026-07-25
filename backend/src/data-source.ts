import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { DataSource, type DataSourceOptions } from 'typeorm'

import { entities } from './entities.js'

export interface DatabaseOptions {
  databaseUrl?: string
  sqlitePath?: string
  synchronize?: boolean
  dropSchema?: boolean
}

export function createDataSource(options: DatabaseOptions = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
  let connection: DataSourceOptions

  if (databaseUrl?.startsWith('postgres')) {
    connection = {
      type: 'postgres',
      url: databaseUrl,
      entities,
      synchronize: options.synchronize ?? false,
      dropSchema: options.dropSchema ?? false,
      logging: false,
    }
  } else {
    const database = options.sqlitePath ?? process.env.SQLITE_PATH ?? './data/ostanobus.sqlite'
    if (database !== ':memory:') mkdirSync(dirname(resolve(database)), { recursive: true })
    connection = {
      type: 'better-sqlite3',
      database,
      entities,
      synchronize: options.synchronize ?? true,
      dropSchema: options.dropSchema ?? false,
      logging: false,
    }
  }

  return new DataSource(connection)
}
