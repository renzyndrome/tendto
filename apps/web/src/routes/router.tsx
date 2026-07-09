/** TanStack Router — client-side SPA routing (deliberately NOT TanStack Start; see docs 02). */
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";

import { PageEditor } from "../components/editor/page-editor";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      {/* sidebar goes here */}
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <p className="p-6">TendTo — select or create a page.</p>,
});

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$pageId",
  component: function PageRoute() {
    const { pageId } = pageRoute.useParams();
    return <PageEditor pageId={pageId} />;
  },
});

const routeTree = rootRoute.addChildren([indexRoute, pageRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
