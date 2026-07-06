import { createSkeletonHandler } from './skeleton';
export const integrationsHandler = createSkeletonHandler<{
  action: 'connect' | 'disconnect' | 'retry';
}>('Google integrations');
