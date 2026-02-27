import assert from "node:assert/strict";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, buttonVariants } from "@/components/ui/button";

describe("Button", () => {
  test("renders a button with default styling classes", () => {
    const html = renderToStaticMarkup(
      React.createElement(Button, null, "Save card"),
    );

    assert.match(html, /^<button/);
    assert.match(html, /data-slot="button"/);
    assert.match(html, /Save card/);
    assert.match(html, /bg-primary/);
  });

  test("applies variant, size, and custom classes", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Button,
        { variant: "destructive", size: "lg", className: "custom-class" },
        "Delete",
      ),
    );

    assert.match(html, /bg-destructive/);
    assert.match(html, /h-10/);
    assert.match(html, /custom-class/);
  });

  test("supports asChild rendering via slot", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Button,
        { asChild: true },
        React.createElement("a", { href: "/cards/123" }, "Open card"),
      ),
    );

    assert.match(html, /^<a/);
    assert.doesNotMatch(html, /^<button/);
    assert.match(html, /href="\/cards\/123"/);
    assert.match(html, /data-slot="button"/);
  });

  test("exposes composable class variants helper", () => {
    const classes = buttonVariants({ variant: "secondary", size: "sm" });

    assert.match(classes, /bg-secondary/);
    assert.match(classes, /h-8/);
  });
});
