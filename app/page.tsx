import LiveTranscriber from "@/components/LiveTranscriber";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col px-4 pt-10 sm:pt-10">
      <header className="mb-6 flex items-center justify-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Myna</h1>
      </header>
      <LiveTranscriber />
    </main>
  );
}
