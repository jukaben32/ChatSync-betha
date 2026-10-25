import { app } from '../src/app.js';

export default async function handler(req: any, res: any) {
  const response = await app.inject({
    method: req.method,
    url: req.url,
    headers: req.headers,
    payload: req.body,
  });
  res.status(response.statusCode);
  const contentType = response.headers?.['content-type'];
  if (contentType) {
    res.setHeader('content-type', contentType);
  }
  res.end(response.body);
}
