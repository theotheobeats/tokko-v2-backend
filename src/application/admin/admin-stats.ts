/**
 * Admin — dashboard statistics use case.
 *
 * Pure read-model aggregation over D1. No event choreography: every number
 * is a live COUNT/SUM query so the dashboard always reflects current state.
 */

import type { OrderRepository } from "../../infrastructure/repos/d1-order-repo";
import type { StoreRepository } from "../store/store-repo";
import type { D1AdminUserRepository } from "../../infrastructure/repos/d1-admin-user-repo";
import type { TicketRepository } from "../../infrastructure/repos/d1-ticket-repo";
import type { ReportRepository } from "../../infrastructure/repos/d1-report-repo";

export interface AdminStats {
  users: {
    total: number;
    admins: number;
    banned: number;
    new7d: number;
    new30d: number;
  };
  stores: {
    total: number;
    published: number;
    draft: number;
    suspended: number;
  };
  orders: {
    total: number;
    pending: number;
    contacted: number;
    completed: number;
    gmv: number;
    orders7d: number;
    gmv7d: number;
    orders30d: number;
    gmv30d: number;
  };
  tickets: Record<string, number>;
  reports: Record<string, number>;
}

export class GetAdminStats {
  constructor(
    private readonly userRepo: D1AdminUserRepository,
    private readonly storeRepo: StoreRepository,
    private readonly orderRepo: OrderRepository,
    private readonly ticketRepo: TicketRepository,
    private readonly reportRepo: ReportRepository,
  ) {}

  async execute(): Promise<AdminStats> {
    const [userCounts, users7d, users30d, storeCounts, orderCounts, gmv, since7, since30, tickets, reports] =
      await Promise.all([
        this.userRepo.counts(),
        this.userRepo.since(7),
        this.userRepo.since(30),
        this.storeRepo.countAll(),
        this.orderRepo.countAll(),
        this.orderRepo.sumTotalAll(),
        this.orderRepo.since(7),
        this.orderRepo.since(30),
        this.ticketRepo.countByStatus(),
        this.reportRepo.countByStatus(),
      ]);

    return {
      users: {
        total: userCounts.total,
        admins: userCounts.admins,
        banned: userCounts.banned,
        new7d: users7d,
        new30d: users30d,
      },
      stores: storeCounts,
      orders: {
        total: orderCounts.all,
        pending: orderCounts.pending,
        contacted: orderCounts.contacted,
        completed: orderCounts.completed,
        gmv,
        orders7d: since7.orders,
        gmv7d: since7.gmv,
        orders30d: since30.orders,
        gmv30d: since30.gmv,
      },
      tickets,
      reports,
    };
  }
}
