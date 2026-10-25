"use client";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/glaze/ui/dropdown-menu";
import { ChevronSort, Icon } from "@/components/glaze/icon";
import { cn } from "@/lib/glaze/utils";
import { chooseOrder, useOrderData, useOrderId, useOrders, type Id, type OrderRow } from "./data";

/** Test orders carry "DEMO / TESTNET —" prefixes and dashes in their titles; show the part a person reads. */
export function orderTitle(title: string) {
  const clean = title.replace(/^\s*DEMO\s*\/\s*TESTNET\s*[—–-]\s*/i, "").replace(/\s+[—–]\s+/g, ": ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
const unfunded = (order: OrderRow) => order.status === "awaiting_funding" || order.status === "draft";

function Dot({ funded }: { funded: boolean }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", funded ? "bg-ok-text" : "bg-text-disabled")} />;
}

/** Which order every buyer page shows. */
export function OrderSwitcher() {
  const orderId = useOrderId();
  const listed = useOrders();
  const { summary } = useOrderData(orderId);
  if (!listed) return null;
  // The seeded demo order can sit outside the buyer's list; it is still the order every page shows.
  const orders: OrderRow[] = summary && !listed.some(order => order._id === summary.order._id)
    ? [summary.order as unknown as OrderRow, ...listed] : listed;
  if (orders.length < 2) return null;
  const current = orders.find(order => order._id === orderId);
  const title = current?.title;
  const groups = [
    { label: "Funded", rows: orders.filter(order => !unfunded(order)) },
    { label: "Awaiting funding", rows: orders.filter(unfunded) },
  ].filter(group => group.rows.length);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 max-w-72 items-center gap-2 rounded-pill border border-line-control px-3 py-1 type-label-sm text-text-1 hover:bg-hover" aria-label="Switch order">
        {current && <Dot funded={!unfunded(current)} />}
        <span className="truncate">{title ? orderTitle(title) : "Choose an order"}</span>
        <Icon icon={ChevronSort} size={12} className="shrink-0 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuRadioGroup value={orderId ?? undefined} onValueChange={value => chooseOrder(value as Id<"orders">)}>
          {groups.map((group, index) => (
            <DropdownMenuGroup key={group.label}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.rows.map(order => (
                <DropdownMenuRadioItem key={order._id} value={order._id} className="py-2">
                  <span className="min-w-0 flex-1 truncate">{orderTitle(order.title)}</span>
                  <span className="ms-3 shrink-0 type-label-sm text-text-3">{order.acceptedCount}/{order.quantityRequested} clips</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
