import Image from "next/image";
import LiveTranscriber from "@/components/LiveTranscriber";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-10 sm:pt-10">
      {/* Title centred; toggle pinned right without pushing the title off-centre */}
      <header className="relative mb-6 flex items-center justify-center">
        {/* Wordmark "MY [bird] NA". Everything is sized in em, so the bird
            scales with the text size. */}
        <h1 className="flex items-end text-xl leading-none font-medium tracking-wide sm:text-xl">
          <span className="sr-only">Myna</span>
          <span aria-hidden="true">MY</span>
          {/* Narrow slot between the letters; the bird overflows it so its neck
              sits in the gap, its head rises above and its beak hangs over "NA" */}
          <span aria-hidden="true" className="relative h-[1.25em] w-[1.1em] shrink-0">
            <Image
              src="/logo.svg"
              alt=""
              width={96}
              height={96}
              loading="eager"
              className="absolute bottom-[-0.15em] left-[-1em] size-[3em] max-w-none dark:drop-shadow-[0_0_1px_rgba(255,255,255,0.7)]"
            />
          </span>
          <span aria-hidden="true">NA</span>
        </h1>
        <div className="absolute right-0">
          <ThemeToggle />
        </div>
      </header>
      <LiveTranscriber />
    </main>
  );
}
