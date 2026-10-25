import { SiteNav } from "@/components/site-nav";
import { Hero } from "@/features/landing/hero";
import { BuiltOn } from "@/features/landing/built-on";
import { HowItWorks } from "@/features/landing/how-it-works";
import { CatchSection } from "@/features/landing/catch-carousel";
import { Money } from "@/features/landing/money";
import { Roles } from "@/features/landing/roles";
import { ProofLog } from "@/features/landing/proof-log";
import { Footer } from "@/features/landing/footer";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <BuiltOn />
        <HowItWorks />
        <CatchSection />
        <Money />
        <Roles />
        <ProofLog />
      </main>
      <Footer />
    </>
  );
}
