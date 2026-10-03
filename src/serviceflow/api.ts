import 'server-only';
import { apiRequest, type ApiResponse } from './client';
import type { ConnectionKey } from './key';
import type { Connection, OrderCount, OrderListQuery, OrderSummary } from './types';

// Typed routes from contract §7. Each returns the parsed body plus X-SF-Server-Time.

const V1 = '/serviceflow/v1';

export function getConnection(key: ConnectionKey): Promise<ApiResponse<Connection>> {
  return apiRequest<Connection>(key, `${V1}/connection`);
}

export function getOrderCounts(key: ConnectionKey): Promise<ApiResponse<OrderCount[]>> {
  return apiRequest<OrderCount[]>(key, `${V1}/orders/counts`);
}

export type OrderPage = ApiResponse<OrderSummary[]> & { total: number; totalPages: number };

export async function listOrders(key: ConnectionKey, query: OrderListQuery = {}): Promise<OrderPage> {
  const { include, ...rest } = query;
  const res = await apiRequest<OrderSummary[]>(key, `${V1}/orders`, {
    query: { ...rest, include: include?.length ? include.join(',') : undefined },
  });
  return {
    ...res,
    total: Number(res.headers.get('X-WP-Total') ?? res.data.length),
    totalPages: Number(res.headers.get('X-WP-TotalPages') ?? 1),
  };
}
