import LiveTranscriber from "@/components/LiveTranscriber";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-6 sm:pt-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Myna</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Speak Burmese or English and watch it turn into text, live.
        </p>
      </header>
      <LiveTranscriber />
    </main>
  );
}
