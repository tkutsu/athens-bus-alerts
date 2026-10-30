"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Icon } from "@/components/icon";
import { formatTransitName } from "@/lib/display";
import type { Favorite, LineSubscription, StopSummary } from "@/lib/types";

interface FavoritesDialogProps {
  open: boolean;
  onClose: () => void;
  favorites: Favorite[];
  setFavorites: Dispatch<SetStateAction<Favorite[]>>;
  selectedStop: StopSummary | null;
  subscriptions: LineSubscription[];
  onEnable: (favorite: Favorite) => Promise<void>;
  setStatus: (message: string) => void;
  setError: (message: string) => void;
}

function stopReference(stop: StopSummary) {
  return { code: stop.code, name: stop.name };
}

function sortFavorites(favorites: readonly Favorite[]): Favorite[] {
  return [...favorites].sort(
    (a, b) =>
      (b.lastEnabledAt ?? "").localeCompare(a.lastEnabledAt ?? "") ||
      a.name.localeCompare(b.name, "en"),
  );
}

/** Owns favorite editing and menu behavior while the app owns persisted presets. */
export function FavoritesDialog({
  open,
  onClose,
  favorites,
  setFavorites,
  selectedStop,
  subscriptions,
  onEnable,
  setStatus,
  setError,
}: FavoritesDialogProps) {
  const selectedLineIds = useMemo(
    () => [...new Set(subscriptions.map((subscription) => subscription.lineId))],
    [subscriptions],
  );
  const canSaveFavorite = selectedStop !== null && selectedLineIds.length > 0;
  const [favoriteName, setFavoriteName] = useState("");
  const [favoriteMenu, setFavoriteMenu] = useState<{
    favoriteId: string;
    left: number;
    top: number;
  } | null>(null);
  const favoritesDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = favoritesDialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!favoriteMenu) return;

    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-favorite-menu-popup]")) return;
      if (event.target.closest("[data-favorite-menu-trigger]")) return;
      setFavoriteMenu(null);
    };
    const closeOnViewportChange = () => setFavoriteMenu(null);

    document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [favoriteMenu]);

  function saveFavorite() {
    if (!selectedStop || selectedLineIds.length === 0) return;
    const name = favoriteName.trim();
    if (name.length < 1 || name.length > 40) {
      setError("Favorite names must contain 1 to 40 characters.");
      return;
    }
    const existing = favorites.find(
      (favorite) => favorite.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing && !window.confirm(`Replace the existing "${existing.name}" favorite?`)) {
      return;
    }
    const now = new Date().toISOString();
    const favorite: Favorite = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      stop: stopReference(selectedStop),
      routes: subscriptions.map(({ lineId, routeCode }) => ({
        lineId,
        routeCode,
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastEnabledAt: existing?.lastEnabledAt ?? null,
    };
    setFavorites((current) => [
      ...current.filter((item) => item.id !== favorite.id),
      favorite,
    ]);
    setFavoriteName("");
    onClose();
    setStatus(`Saved "${name}".`);
  }

  function renameFavorite(favorite: Favorite) {
    const value = window.prompt("Favorite name", favorite.name)?.trim();
    if (!value || value === favorite.name) return;
    if (value.length > 40) {
      setError("Favorite names can be at most 40 characters.");
      return;
    }
    if (
      favorites.some(
        (item) =>
          item.id !== favorite.id &&
          item.name.toLowerCase() === value.toLowerCase(),
      )
    ) {
      setError("Another favorite already uses that name.");
      return;
    }
    setFavorites((current) =>
      current.map((item) =>
        item.id === favorite.id
          ? { ...item, name: value, updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  }

  function updateFavorite(favorite: Favorite) {
    if (!selectedStop || selectedLineIds.length === 0) {
      setError("Choose a stop and at least one line first.");
      return;
    }
    setFavorites((current) =>
      current.map((item) =>
        item.id === favorite.id
          ? {
              ...item,
              stop: stopReference(selectedStop),
              routes: subscriptions.map(({ lineId, routeCode }) => ({
                lineId,
                routeCode,
              })),
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    setStatus(`Updated "${favorite.name}".`);
  }

  function deleteFavorite(favorite: Favorite) {
    if (!window.confirm(`Delete "${favorite.name}"?`)) return;
    setFavorites((current) => current.filter((item) => item.id !== favorite.id));
  }

  function toggleFavoriteMenu(
    favoriteId: string,
    button: HTMLButtonElement,
  ) {
    if (favoriteMenu?.favoriteId === favoriteId) {
      setFavoriteMenu(null);
      return;
    }

    const rect = button.getBoundingClientRect();
    const menuWidth = 128;
    const menuHeight = 96;
    const viewportMargin = 8;
    const left = Math.min(
      window.innerWidth - menuWidth - viewportMargin,
      Math.max(viewportMargin, rect.right - menuWidth),
    );
    const top =
      rect.bottom + menuHeight + viewportMargin <= window.innerHeight
        ? rect.bottom + 4
        : Math.max(viewportMargin, rect.top - menuHeight - 4);
    setFavoriteMenu({ favoriteId, left, top });
  }

  return (
      <dialog
        aria-labelledby="favorites-heading"
        className="favorites-dialog"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        onClose={() => {
          setFavoriteMenu(null);
          onClose();
        }}
        ref={favoritesDialogRef}
      >
        <div className="favorites-sheet">
          <div className="flex items-center justify-between gap-3 border-b border-ink/15 pb-4">
            <div className="flex items-center gap-2">
              <Icon name="star" className="size-5 text-signal" />
              <h2 className="section-label text-signal" id="favorites-heading">
                Favorites
              </h2>
            </div>
            <button
              aria-label="Close favorites"
              className="flex size-10 items-center justify-center text-xl text-ink/60 hover:text-ink"
              onClick={() => onClose()}
              type="button"
            >
              ×
            </button>
          </div>

          {canSaveFavorite && (
            <form
              className="border-b border-ink/15 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveFavorite();
              }}
            >
              <label className="section-label" htmlFor="favorite-name">
                Save current setup
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  className="field min-w-0 flex-1"
                  id="favorite-name"
                  maxLength={40}
                  onChange={(event) => setFavoriteName(event.target.value)}
                  placeholder="Favorite name"
                  value={favoriteName}
                />
                <button
                  className="primary-button"
                  disabled={!favoriteName.trim()}
                  type="submit"
                >
                  Save
                </button>
              </div>
              <p className="mt-2 text-xs text-ink/55">
                {formatTransitName(selectedStop?.name ?? "")} ·{" "}
                {selectedLineIds.map(formatTransitName).join(" · ")}
              </p>
            </form>
          )}

          <div className="favorites-list max-h-[55vh] overflow-x-hidden overflow-y-auto">
            {favorites.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink/45">
                <p>No favorites saved yet.</p>
                <p className="mt-1">Select a stop and at least one bus line to save one.</p>
              </div>
            ) : (
              <div className="divide-y divide-ink/10">
                {sortFavorites(favorites).map((favorite) => (
                  <div className="flex items-center gap-3 py-4" key={favorite.id}>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void onEnable(favorite)}
                      type="button"
                    >
                      <span className="block truncate font-semibold">{favorite.name}</span>
                      <span className="block truncate text-xs text-ink/55">
                        {formatTransitName(favorite.stop.name)} ·{" "}
                        {favorite.routes
                          .map(({ lineId }) => formatTransitName(lineId))
                          .join(" · ")}
                      </span>
                    </button>
                    <button
                      className="small-action"
                      onClick={() => void onEnable(favorite)}
                      type="button"
                    >
                      Enable
                    </button>
                    <button
                      aria-expanded={favoriteMenu?.favoriteId === favorite.id}
                      aria-haspopup="menu"
                      aria-label={`Actions for ${favorite.name}`}
                      className="small-action"
                      data-favorite-menu-trigger
                      onClick={(event) =>
                        toggleFavoriteMenu(favorite.id, event.currentTarget)
                      }
                      type="button"
                    >
                      •••
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {favoriteMenu && (() => {
          const favorite = favorites.find(
            (item) => item.id === favoriteMenu.favoriteId,
          );
          if (!favorite) return null;
          return (
            <div
              className="favorite-menu-popup w-32 border border-ink/15 bg-paper p-1 shadow-lg"
              data-favorite-menu-popup
              role="menu"
              style={{ left: favoriteMenu.left, top: favoriteMenu.top }}
            >
              <button
                className="menu-action"
                onClick={() => {
                  renameFavorite(favorite);
                  setFavoriteMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                Rename
              </button>
              <button
                className="menu-action"
                onClick={() => {
                  updateFavorite(favorite);
                  setFavoriteMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                Update
              </button>
              <button
                className="menu-action text-red-700"
                onClick={() => {
                  deleteFavorite(favorite);
                  setFavoriteMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                Delete
              </button>
            </div>
          );
        })()}
      </dialog>
  );
}
