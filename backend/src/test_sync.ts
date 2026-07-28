import { createApp } from './app.js';
import { createDataSource } from './data-source.js';

async function run() {
  const ds = createDataSource();
  await ds.initialize();
  const app = await createApp({ dataSource: ds, logger: false });
  
  const payload = {
    clientId: '537f77ce-2edb-4ce1-8077-b9c1d6368d18',
    events: [
      {
        id: '20c7540f-7f72-4d22-b52e-c322b793db5e',
        type: 'bus_missing',
        routeId: 'route1',
        directionId: 'dir1',
        stopId: 'stop1',
        occurredAt: new Date().toISOString()
      }
    ]
  };

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/events/sync',
    payload
  });
  
  console.log(res.statusCode, res.json());
  await ds.destroy();
}

run();
