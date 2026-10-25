import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/features/landing/hero";
import { BuiltOn } from "@/features/landing/built-on";
import { CatchSection } from "@/features/landing/catch-carousel";
import { Money } from "@/features/landing/money";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <BuiltOn />
        <CatchSection />
        <Money />
      </main>
    </>
  );
}
