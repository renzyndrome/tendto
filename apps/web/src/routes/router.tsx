/** TanStack Router — client-side SPA routing (deliberately NOT TanStack Start; see docs 02). */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { CalendarView } from "../components/calendar/calendar-view";
import { DayView } from "../components/calendar/day-view";
import { CollectionView } from "../components/collection/collection-view";
import { PageEditor } from "../components/editor/page-editor";
import { FocusView } from "../components/focus/focus-view";
import { AppShell } from "../components/layout/app-shell";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function IndexRoute() {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-subtle">Select a page, or create a new one.</p>
      </div>
    );
  },
});

const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$pageId",
  component: function PageRoute() {
    const { pageId } = pageRoute.useParams();
    return <PageEditor pageId={pageId} />;
  },
});

const collectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$collectionId",
  component: function CollectionRoute() {
    const { collectionId } = collectionRoute.useParams();
    return <CollectionView collectionId={collectionId} />;
  },
});

/**
 * A card's detail dialog is a ROUTE, not component state — so it is linkable, browser Back
 * closes it, and a refresh reopens the same card (Trello's `/c/<id>` behaviour).
 */
const collectionItemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$collectionId/i/$itemId",
  component: function CollectionItemRoute() {
    const { collectionId, itemId } = collectionItemRoute.useParams();
    return <CollectionView collectionId={collectionId} openItemId={itemId} />;
  },
});

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar",
  component: CalendarView,
});

/**
 * The day view is a ROUTE keyed by a local `YYYY-MM-DD`, for the same reasons the card dialog is
 * one: a day is linkable, Back returns to the month, and a reload keeps you on the day.
 */
const calendarDayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/calendar/$date",
  component: function CalendarDayRoute() {
    const { date } = calendarDayRoute.useParams();
    return <DayView dateKey={date} />;
  },
});

const focusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/focus",
  component: FocusView,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  pageRoute,
  collectionRoute,
  collectionItemRoute,
  calendarRoute,
  calendarDayRoute,
  focusRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
