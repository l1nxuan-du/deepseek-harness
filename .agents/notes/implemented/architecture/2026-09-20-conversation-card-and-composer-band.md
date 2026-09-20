# Agent Note: The conversation card and the composer band

Status: implemented

English | [中文](2026-09-20-conversation-card-and-composer-band.zh.md)

## Problem

The material chrome renders the conversation as a rounded card on the field, with the input card and the session's stats line in a band at the column's bottom edge. Two things decide how that reads: which element carries the card, and what happens to transcript content that reaches the composer while the reader scrolls.

## Decision

The conversation root paints the card in its `::before`. The card is the whole column — the session title row and the tabs sit inside it — and the layer is absolutely positioned against the root, which does not scroll, so the card keeps the column's height for the whole session while the header, the transcript, and the composer sit on it. The column that holds the card carries the card's radius, because that column clips its overflow. The clip and the card have to agree: a square clip shows the card's own shadow — the one surface behind the glass that is neither rounded nor transparent — as a square patch in each corner the arc does not cover. The scrollport element cannot carry the card: the input card's acrylic samples the field behind it, and any `backdrop-filter` on an ancestor caps what a descendant's backdrop-filter can see. `isolation` gives the root the stacking context the layer's negative z-index needs.

The seat stays the scroll body's last in-flow item — its `position: sticky; bottom: 0` pins it to the scrollport's bottom edge, and a wheel over the footer still moves the transcript — and it carries a masked blur over its own band. The band (the composer dock, the input card, and the stats line) paints no background of its own, so without that layer transcript content travelling through it would read as text printed below the input. The mask ramps the blur in from the seat's top edge, so the transcript dissolves out of legibility as it reaches the composer while everything above the card stays crisp, and the layer paints no fill, so the material around and behind the composer is unchanged. It carries the card's radius, because a backdrop-filter's output is clipped to its element's border box: a square layer would smear the pane's material across the column's rounded bottom corners.

## Alternatives considered

**A pane element wrapping the transcript and carrying the card.** Rejected: a fixed-height pane holds the seat's flow position away from the scroll range's end, where `position: sticky` can no longer pin it, and a content-sized one scrolls its own rounded frame out of the column.

**Painting the card on the scrollport element.** Rejected: the composer seat is its child, so the card's own `backdrop-filter` would cap the input card's backdrop at the pane's fill rather than the field behind it.

**A gradient veil over the composer band, ramping to an opaque page colour.** Rejected: hiding the content that way paints a flat band across the column and dims the material behind the composer, while a masked blur dissolves the same content without changing the surface.

## Consequences

The transcript never surfaces below the input card, and the card's own frost reads against the pane's material and the field behind it. The card is a layer on the conversation root, so a skin that wants the material elsewhere styles that layer. ChatView keeps reading the seat's rectangle as the transcript's visible bottom for paging anchors.
