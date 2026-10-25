import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/features/landing/hero";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
      </main>
    </>
  );
}
