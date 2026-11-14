# Player invitation email assets

The email keeps all text and invitation URLs in editable HTML. PNG artwork is
attached inline with Content-IDs by `plane.utils.player_invitation_email`, so
neither local nor production mail needs a public image server. These files ship
with the API/worker's existing `COPY templates templates/` image layer. Deploy
the updated worker image with the template and assets together.

The small icon PNGs are rendered from the adjacent editable SVG sources. The
`hero.png` illustration was made with the built-in image-generation tool and
optimized for display in the email, retaining its transparency.

Artwork prompt:

> Create one polished small 3D sports illustration asset for the upper-right
> corner of a blue-and-white player invitation email. Transparent background.
> Composition: a glossy royal-blue American football helmet facing left in the
> front left, white faceguard and two slim white stripes; one rich brown American
> football with white laces and white stripes lying horizontally in the front
> right; a blue-framed white coach clipboard behind them on the right, tilted
> slightly clockwise, showing a minimal blue football play diagram with three X
> marks, a small O and a curved arrow. Soft pale-blue oval grounding shadow
> beneath the objects, a couple of tiny blue accent strokes beside the helmet.
> Clean premium friendly product illustration, smooth rounded forms, subtle
> highlights, crisp edges, colors #006be6 #168bff #b8ddff white and football brown.
> Close crop around the group, generous transparent margin. No text, no lettering,
> no watermark, no background panel, no extra objects. Intended to be readable at
> 240px wide.

The standalone preview in `artifacts/player-invitation-preview.html` uses sample
details, embedded image data, and an intentionally invalid preview token. It
does not send mail. Actual clients may simplify shadows, gradients, and rounded
corners; solid background colors, tables, and an Outlook button fallback keep
the content and invitation link usable.
