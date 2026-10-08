type ExampleSocket = {
  connected: boolean;
  disconnect: () => void;
  emit: (event: string, payload: unknown) => void;
  on: (event: string, listener: (payload?: unknown) => void) => void;
};

interface Window {
  io: (options: { readonly transports: readonly string[] }) => ExampleSocket;
}
