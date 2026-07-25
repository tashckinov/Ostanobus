import 'reflect-metadata'

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import fastifyStatic from '@fastify/static'

import { createApp } from './app.js'
import { createDataSource } from './data-source.js'
import { seedDatabase } from './seed.js'

const dataSource = createDataSource()
await dataSource.initialize()
await seedDatabase(
  dataSource,
  resolve(
    process.env.SEED_DATA_DIR ?? fileURLToPath(new URL('../../public/data', import.meta.url)),
  ),
)

const app = await createApp({ dataSource, logger: process.env.LOG_DISABLED !== '1' })
const adminDirectory = resolve(
  process.env.ADMIN_STATIC_DIR ?? fileURLToPath(new URL('../../admin/dist', import.meta.url)),
)

if (existsSync(adminDirectory)) {
  await app.register(fastifyStatic, {
    root: adminDirectory,
    prefix: '/admin/',
    decorateReply: false,
  })
  app.get('/admin', async (_request, reply) => reply.redirect('/admin/'))
}

const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST ?? '0.0.0.0'

await app.listen({ port, host })

const shutdown = async () => {
  await app.close()
  await dataSource.destroy()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
