import { Server as BunEngine } from '@socket.io/bun-engine';
import { Server as SocketIoServer } from 'socket.io';
import type { Order } from '#domain/types';
import { findAuthorizedOrder } from '#services/orderService';

const socketPath = '/socket.io/';
const orderRoom = (orderId: string): string => `order:${orderId}`;
const engine = new BunEngine({
  path: socketPath,
  maxHttpBufferSize: 16 * 1024,
  allowRequest: async request => {
    const transport = new URL(request.url).searchParams.get('transport');
    if (transport && transport !== 'websocket') throw new Error('Only WebSocket transport is supported');
  },
});
const io = new SocketIoServer({ serveClient: true, transports: ['websocket'], maxHttpBufferSize: 16 * 1024 });
io.bind(engine);

io.on('connection', socket => {
  socket.on(
    'order.watch',
    (value: unknown, acknowledge?: (result: { readonly ok: boolean; readonly code?: string }) => void) => {
      if (!value || typeof value !== 'object') {
        acknowledge?.({ ok: false, code: 'INVALID_ORDER_AUTH' });
        return;
      }
      const candidate = value as { readonly orderId?: unknown; readonly token?: unknown };
      if (typeof candidate.orderId !== 'string' || typeof candidate.token !== 'string') {
        acknowledge?.({ ok: false, code: 'INVALID_ORDER_AUTH' });
        return;
      }
      const orderId = candidate.orderId;
      const token = candidate.token;
      void findAuthorizedOrder(orderId, token)
        .then(order => {
          if (!order) throw new Error('Order not found');
          for (const room of socket.rooms) {
            if (room.startsWith('order:')) void socket.leave(room);
          }
          void socket.join(orderRoom(orderId));
          acknowledge?.({ ok: true });
        })
        .catch(() => acknowledge?.({ ok: false, code: 'ORDER_NOT_FOUND' }));
    },
  );
});

const handler = engine.handler();

export const orderRealtime = {
  handles: (request: Request): boolean => new URL(request.url).pathname.startsWith(socketPath),
  handler: () => handler,
  publishOrderUpdated: (order: Order): void => {
    io.to(orderRoom(order.id)).emit('order.updated', {
      orderId: order.id,
      paymentStatus: order.paymentStatus,
      checkoutStatus: order.checkoutStatus,
    });
  },
  close: async (): Promise<void> => {
    await io.close();
  },
};
