import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

export interface RouteDefinition {
  method: string;
  path: string;
  handler: APIGatewayProxyHandlerV2;
}

interface CompiledRoute extends RouteDefinition {
  parameterNames: string[];
  pattern: RegExp;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compileRoute = (route: RouteDefinition): CompiledRoute => {
  const parameterNames: string[] = [];
  const segments = route.path.split('/').filter(Boolean);
  const source = segments
    .map((segment) => {
      if (segment.startsWith(':')) {
        parameterNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return escapePattern(segment);
    })
    .join('/');

  return { ...route, parameterNames, pattern: new RegExp(`^/${source}/?$`) };
};

export interface RouteMatch {
  handler: APIGatewayProxyHandlerV2;
  pathParameters: Record<string, string>;
}

export const createRouter = (definitions: RouteDefinition[]) => {
  const routes = definitions.map(compileRoute);

  return (method: string, rawPath: string): RouteMatch | undefined => {
    for (const route of routes) {
      if (route.method !== 'ANY' && route.method !== method) continue;
      const match = route.pattern.exec(rawPath);
      if (!match) continue;

      const pathParameters: Record<string, string> = {};
      route.parameterNames.forEach((name, index) => {
        const value = match[index + 1];
        if (value !== undefined) pathParameters[name] = decodeURIComponent(value);
      });
      return { handler: route.handler, pathParameters };
    }
    return undefined;
  };
};
