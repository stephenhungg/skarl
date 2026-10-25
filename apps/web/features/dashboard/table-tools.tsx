"use client";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@/components/glaze/ui/tabs";
import { Icon, Search } from "@/components/glaze/icon";

/** The toolbar row above a table: views as tabs with counts on the left, search on the right. */
export function TableToolbar<T extends string>({ views, value, onChange, query, onQuery, placeholder }: {
  views: { value: T; label: string; count: number }[];
  value: T; onChange: (value: T) => void;
  query: string; onQuery: (query: string) => void; placeholder: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <Tabs value={value} onValueChange={next => onChange(next as T)} className="min-w-0">
        <TabsList size="sm">
          {views.map(view => <TabsTrigger key={view.value} value={view.value}>{view.label}<TabsCount>{view.count}</TabsCount></TabsTrigger>)}
        </TabsList>
      </Tabs>
      <label className="field ms-auto flex h-(--control-sm) w-full items-center gap-2 px-3 sm:w-64">
        <Icon icon={Search} size={14} className="shrink-0 text-text-3" />
        <input type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent type-label-sm text-text-1 outline-none placeholder:text-text-3" aria-label={placeholder} />
      </label>
    </div>
  );
}
