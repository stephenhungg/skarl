"use client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/glaze/ui/dropdown-menu";
import { ChevronSort, Icon } from "@/components/glaze/icon";
import { chooseOrder, useOrderId, useOrders } from "./data";
import { humanize } from "./format";

/** Which order every controller page shows. */
export function OrderSwitcher() {
  const orderId = useOrderId();
  const orders = useOrders();
  const current = orders?.find(order => order._id === orderId);
  if (!orders || orders.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 max-w-72 items-center gap-2 rounded-pill border border-line-control px-3 py-1 type-label-sm text-text-1 hover:bg-hover" aria-label="Switch order">
        <span className="truncate">{current?.title ?? "Choose an order"}</span>
        <Icon icon={ChevronSort} size={12} className="shrink-0 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {orders.map(order => (
          <DropdownMenuItem key={order._id} onClick={() => chooseOrder(order._id)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate type-label">{order.title}</span>
              <span className="type-label-sm text-text-3">{humanize(order.status)} &middot; {order.acceptedCount} of {order.quantityRequested} accepted &middot; <span className="mono">{order.publicId.slice(0, 22)}</span></span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
