// The open drawing's label legends (legendBook.ts), read from its show data. While the Label Legend
// Manager writes a new book and draws its devices again in one batch, the book it's writing stands in
// for the saved one, which show.ts reads afresh only once the batch is over.

import { readShow } from "../show.ts";
import { cleanBook, EMPTY_BOOK, LEGEND_KEY, type Legend, type LegendBook } from "./legendBook.ts";

let writing: LegendBook | null = null;

/** The drawing's legends. */
export function readLegends(): LegendBook {
  return writing ?? cleanBook(readShow<unknown>(LEGEND_KEY, EMPTY_BOOK));
}

/** The legend called `name`, or undefined (Rodeo's own labels). */
export function legendNamed(name: string): Legend | undefined {
  return name ? readLegends().legends.find((l) => l.name === name) : undefined;
}

/** Runs `fn` with `book` read as the drawing's legends. */
export function whileWriting<T>(book: LegendBook, fn: () => T): T {
  writing = book;
  try {
    return fn();
  } finally {
    writing = null;
  }
}
