import { app } from '../server/index.js';

export default function handler(req: any, res: any) {
  return app(req, res);
}
