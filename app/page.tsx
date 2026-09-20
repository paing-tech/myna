import LiveTranscriber from "@/components/LiveTranscriber";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-10 sm:pt-10">
      {/* Title centred; toggle pinned right without pushing the title off-centre */}
      <header className="relative mb-6 flex items-center justify-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Myna</h1>
        <div className="absolute right-0">
          <ThemeToggle />
        </div>
      </header>
      <LiveTranscriber />
    </main>
  );
}
