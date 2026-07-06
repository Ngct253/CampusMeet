import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export const apiEvent = (path = '/health'): APIGatewayProxyEventV2 => ({
  version: '2.0',
  routeKey: '$default',
  rawPath: path,
  rawQueryString: '',
  headers: {},
  requestContext: {
    accountId: 'test',
    apiId: 'test',
    domainName: 'test',
    domainPrefix: 'test',
    http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
    requestId: 'test-request-id',
    routeKey: '$default',
    stage: '$default',
    time: '',
    timeEpoch: 0,
  },
  isBase64Encoded: false,
});
