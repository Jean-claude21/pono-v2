import handler from '@tanstack/react-start/server-entry';
import { isApiPath, relay } from './lib/relay';
import { paraglideMiddleware } from './paraglide/server.js';

export default {
  fetch(request: Request): Promise<Response> {
    // The API's paths carry no page and no language: straight to the API.
    if (isApiPath(new URL(request.url).pathname)) return relay(request);
    // Every other request resolves its language before rendering, so server-rendered text matches it.
    return paraglideMiddleware(request, () => handler.fetch(request));
  },
};
