/**
 * Deno globals for Supabase Edge Functions. The app tsconfig targets Expo/Node, not Deno;
 * this file lets `tsc` / the IDE recognize `Deno` when those sources are part of the project.
 */
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: {
    get(key: string): string | undefined;
  };
};

/** Map Deno URL + JSR specifiers to npm types so Edge Functions typecheck under the Expo tsconfig. */
declare module "https://esm.sh/@supabase/supabase-js@2.98.0" {
  export * from "@supabase/supabase-js";
}

declare module "jsr:@supabase/functions-js/edge-runtime.d.ts" {
  // Side-effect types for Supabase Edge runtime; Deno global is declared above.
}
