import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/features/landing/hero";
import { BuiltOn } from "@/features/landing/built-on";
import { CatchSection } from "@/features/landing/catch-carousel";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <BuiltOn />
        <CatchSection />
      </main>
    </>
  );
}
