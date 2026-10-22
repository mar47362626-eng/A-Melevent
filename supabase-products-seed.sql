-- Adds 50 sample products across the existing Wigs, Beauty, Fragrance, and Shoes categories.
-- Prices are example amounts in NGN. Review product details, availability, and prices before selling.
-- Images are real Unsplash stock photos used as illustrative placeholders, not photos of guaranteed inventory.
-- The insert skips matching names/categories, so it can be safely run again.

begin;

with seed_products (name, category, detail, description, price, tag, image) as (
  values
    ('Kinky Curly Bounce', 'Wigs', 'Natural curls · 18 inch', 'A defined curly style with soft-looking volume for everyday wear or special plans. Confirm the exact fibre, cap construction, and care instructions before listing.', 72000, 'Curly favourite', 'photo-1595476108010-b4d1f102b1b1'),
    ('Silky Straight Classic', 'Wigs', 'Sleek straight · 20 inch', 'A smooth, straight look with a versatile length that works for polished daytime outfits and evening styling.', 78000, 'Sleek style', 'photo-1583241800698-e8ab01830a07'),
    ('Body Wave Everyday', 'Wigs', 'Body wave · 18 inch', 'A softly waved style for a relaxed finish with movement. Check the package for the confirmed fibre and maintenance details.', 74000, 'Easy wear', 'photo-1529139574466-a303027c1d8b'),
    ('Deep Wave Glam', 'Wigs', 'Deep wave · 22 inch', 'A longer, defined wave pattern for a fuller statement look. Ask us about the exact length and cap details before purchase.', 92000, 'Statement hair', 'photo-1534528741775-53994a69daeb'),
    ('Water Wave Soft Volume', 'Wigs', 'Water wave · 20 inch', 'A textured wave style with a soft, voluminous finish. Style gently and follow the care instructions supplied with the wig.', 85000, 'Soft volume', 'photo-1524504388940-b1c1722653e1'),
    ('Chic Bob Cut', 'Wigs', 'Straight bob · 12 inch', 'A neat bob length for an easy-to-style look that pairs well with casual and dressed-up outfits.', 62000, 'Short & chic', 'photo-1524250502761-1ac6f2e30d43'),
    ('Loose Wave Luxe', 'Wigs', 'Loose wave · 24 inch', 'A long loose-wave look with plenty of styling options. Confirm the supplied fibre type and length before ordering.', 105000, 'Luxe length', 'photo-1508214751196-bcfd4ca60f91'),
    ('Yaki Straight Natural', 'Wigs', 'Yaki texture · 18 inch', 'A straight style with a textured finish for a natural-inspired look. Follow the included product care guidance.', 76000, 'Natural texture', 'photo-1517841905240-472988babdf9'),
    ('Afro Curl Volume', 'Wigs', 'Afro curls · 16 inch', 'A full curly silhouette for customers who love texture and volume. Confirm the curl pattern and cap fit before listing.', 82000, 'Full of texture', 'photo-1526510747491-58f928ec870f'),
    ('Caramel Highlight Wave', 'Wigs', 'Highlighted wave · 20 inch', 'A softly waved style with a warm highlighted look for a little extra dimension.', 89000, 'Warm highlight', 'photo-1531123897727-8f129e1688ce'),
    ('Lace Front Straight', 'Wigs', 'Straight style · 22 inch', 'A long straight style with a lace-front look. Verify lace type, density, and construction against the actual item before publishing.', 98000, 'Polished finish', 'photo-1544005313-94ddf0286df2'),
    ('Curly Bob Fresh', 'Wigs', 'Curly bob · 14 inch', 'A bouncy curly bob for a shorter, lively silhouette with an easy day-to-night feel.', 68000, 'Fresh cut', 'photo-1488426862026-3ee34a7d66df'),
    ('Layered Wave Length', 'Wigs', 'Layered wave · 26 inch', 'A long layered wave style for a flowing look. Confirm the exact length and materials with the supplier.', 112000, 'Long layers', 'photo-1524250502761-1ac6f2e30d43'),

    ('Daily Dew Face Cream', 'Beauty', 'Face moisturiser · 50 ml', 'A lightweight-feel moisturiser for a simple daily skincare routine. Review the actual ingredient list, directions, and suitability information on the package.', 14500, 'Daily care', 'photo-1556228720-195a672e8a03'),
    ('Soft Cloud Body Butter', 'Beauty', 'Body butter · 200 ml', 'A rich-feel body butter for a comfortable self-care routine. Check the supplied packaging for ingredients and directions.', 18500, 'Self-care pick', 'photo-1571781926291-c477ebfd024b'),
    ('Gentle Wash Cleanser', 'Beauty', 'Face cleanser · 150 ml', 'A face cleanser for a simple wash-and-rinse routine. Confirm the actual formula and use directions on the product label.', 12000, 'Clean routine', 'photo-1598440947619-2c35fc9aa908'),
    ('Fresh Start Toner', 'Beauty', 'Facial toner · 200 ml', 'A refreshing toner to use as directed in a personal skincare routine. Review the full ingredient list before use.', 13500, 'Fresh feel', 'photo-1611930022073-b7a4ba5fcccd'),
    ('Glow Routine Serum', 'Beauty', 'Face serum · 30 ml', 'A lightweight serum format for layering into a skincare routine. Verify ingredients, claims, and directions from the supplier before sale.', 16500, 'Routine essential', 'photo-1608571423902-eed4a5ad8108'),
    ('Hydration Drop Serum', 'Beauty', 'Face serum · 30 ml', 'A daily-use serum listing for customers building a simple skincare routine. Follow the actual product label and patch-test guidance.', 17000, 'Hydration step', 'photo-1612817288484-6f916006741a'),
    ('Gloss Moment Lip Oil', 'Beauty', 'Lip oil · 8 ml', 'A glossy lip-care format to keep in a handbag or makeup pouch. Check the packaging for ingredients and application directions.', 8500, 'Pocket favourite', 'photo-1596462502278-27bfdc403348'),
    ('Silky Touch Body Lotion', 'Beauty', 'Body lotion · 250 ml', 'A daily body lotion for a smooth-feel finish after bathing. Confirm ingredients and directions on the supplied product.', 16000, 'Everyday comfort', 'photo-1556229010-6c3f2c9ca5f8'),
    ('Golden Hour Body Oil', 'Beauty', 'Body oil · 100 ml', 'A body oil format for a pampering self-care routine. Verify the actual formula and whether it is suitable for your intended use.', 15500, 'Glow ritual', 'photo-1608248543803-ba4f8c70ae0b'),
    ('Smooth Polish Body Scrub', 'Beauty', 'Body scrub · 250 g', 'A body scrub for occasional use as directed on the actual package. Check ingredients and avoid use on irritated skin.', 14500, 'Weekend ritual', 'photo-1601049541289-9b1b7bbbfe19'),
    ('Comfort Hand Cream', 'Beauty', 'Hand cream · 75 ml', 'A handy moisturiser format for keeping near a desk or in a bag. Review ingredients and directions on the label.', 7000, 'Bag-size care', 'photo-1598440947619-2c35fc9aa908'),
    ('Overnight Skin Cream', 'Beauty', 'Night moisturiser · 50 ml', 'A night-time moisturiser listing for an evening routine. Confirm product ingredients, directions, and claims with the supplier.', 18000, 'Evening routine', 'photo-1571781926291-c477ebfd024b'),
    ('Soft Finish Lip Gloss', 'Beauty', 'Lip gloss · 6 ml', 'A simple gloss for a polished lip look. Check the package for ingredients, shade, and application details.', 6500, 'Finishing touch', 'photo-1596462502278-27bfdc403348'),

    ('Amber Bloom Eau de Parfum', 'Fragrance', 'Eau de parfum · 50 ml', 'A warm amber-inspired scent profile in a gift-friendly size. Fragrance notes are a sample description; confirm the actual scent and concentration.', 32000, 'Warm & inviting', 'photo-1541643600914-78b084683601'),
    ('Citrus Muse Eau de Parfum', 'Fragrance', 'Eau de parfum · 50 ml', 'A bright citrus-inspired scent profile for customers who enjoy fresh fragrance styles. Confirm the scent notes from the supplier.', 30000, 'Fresh pick', 'photo-1594035910387-fea47794261f'),
    ('Velvet Rose Eau de Parfum', 'Fragrance', 'Eau de parfum · 50 ml', 'A floral rose-inspired fragrance listing in a versatile size. Verify the actual fragrance notes and bottle volume before sale.', 34000, 'Floral mood', 'photo-1592945403244-b3fbafd7f539'),
    ('Vanilla Dusk Eau de Parfum', 'Fragrance', 'Eau de parfum · 50 ml', 'A cosy vanilla-inspired scent profile for day or evening wear. Confirm the actual notes and concentration with the product supplier.', 33500, 'Sweet & soft', 'photo-1587017539504-67cfbddac569'),
    ('Clean Slate Eau de Toilette', 'Fragrance', 'Eau de toilette · 50 ml', 'A clean, light fragrance listing for customers who prefer an easy everyday scent. Verify the actual product concentration and notes.', 26500, 'Everyday scent', 'photo-1541643600914-78b084683601'),
    ('Midnight Oud Eau de Parfum', 'Fragrance', 'Eau de parfum · 100 ml', 'A deep oud-inspired scent profile in a larger bottle size. Confirm the actual fragrance notes and volume from the packaging.', 48000, 'Evening favourite', 'photo-1594035910387-fea47794261f'),
    ('Petal Veil Eau de Parfum', 'Fragrance', 'Eau de parfum · 30 ml', 'A soft floral-inspired fragrance in a compact size for gifting or travel. Confirm the actual scent and bottle size.', 24000, 'Small delight', 'photo-1592945403244-b3fbafd7f539'),
    ('Spiced Woods Eau de Parfum', 'Fragrance', 'Eau de parfum · 50 ml', 'A woody, spice-inspired fragrance description for a distinctive scent wardrobe. Verify the actual notes with the supplier.', 36000, 'Bold notes', 'photo-1587017539504-67cfbddac569'),
    ('Daylight Mist Body Spray', 'Fragrance', 'Body mist · 150 ml', 'A lighter body-mist format for refreshing during the day. Check the product packaging for use directions and volume.', 14000, 'Easy refresh', 'photo-1541643600914-78b084683601'),
    ('Soft Musk Eau de Parfum', 'Fragrance', 'Eau de parfum · 50 ml', 'A soft musk-inspired fragrance listing for an understated everyday option. Confirm the actual scent profile and concentration.', 31000, 'Soft signature', 'photo-1594035910387-fea47794261f'),
    ('Golden Sillage Eau de Parfum', 'Fragrance', 'Eau de parfum · 100 ml', 'A warm, statement-style fragrance listing in a generous size. Verify the actual product details and notes before publishing.', 52000, 'Gift-worthy', 'photo-1592945403244-b3fbafd7f539'),
    ('Bloom Pocket Perfume', 'Fragrance', 'Pocket perfume · 10 ml', 'A compact fragrance format to carry on the go. Confirm the actual scent, concentration, and volume on the product label.', 9000, 'On-the-go', 'photo-1587017539504-67cfbddac569'),

    ('Caramel Sculpted Heel', 'Shoes', 'Block heel · caramel', 'A warm-toned block heel for occasions and dressed-up plans. Confirm available sizes, material, heel height, and fit before listing.', 42500, 'A&M favourite', 'photo-1543163521-1bf539c55dd2'),
    ('Cocoa Everyday Sandal', 'Shoes', 'Flat sandal · cocoa', 'A simple flat sandal in a versatile cocoa tone for casual outfits. Check the actual material and size availability.', 28000, 'Easy does it', 'photo-1560343090-f0409e92791a'),
    ('Classic White Sneaker', 'Shoes', 'Low-top sneaker · white', 'A clean low-top sneaker style for everyday outfits. Confirm the actual brand, materials, and size run with your supplier.', 39000, 'Daily staple', 'photo-1542291026-7eec264c27ff'),
    ('City Strap Heel', 'Shoes', 'Strappy heel · black', 'A strappy heel for evening looks and special occasions. Verify heel height, fit, available sizes, and materials before sale.', 45000, 'Night out', 'photo-1515347619252-60a4bf4fff4f'),
    ('Soft Step Slide', 'Shoes', 'Open-toe slide · neutral', 'An easy slip-on slide for relaxed days. Confirm the actual upper and sole materials and available sizes.', 22000, 'Slip-on comfort', 'photo-1600185365483-26d7a4cc7519'),
    ('Retro Court Sneaker', 'Shoes', 'Retro low-top · white', 'A retro-inspired low-top sneaker to pair with casual wardrobe favourites. Confirm style details and available sizes.', 41000, 'Weekend pair', 'photo-1552346154-21d32810aba3'),
    ('Everyday Ballet Flat', 'Shoes', 'Round-toe flat · tan', 'A simple flat shoe for workdays and everyday errands. Check the actual colour, material, and fit before publishing.', 26500, 'Workday ease', 'photo-1608231387042-66d1773070a5'),
    ('Ankara Detail Sandal', 'Shoes', 'Two-strap sandal · print', 'A two-strap sandal listing with a colourful accent for casual outfits. Verify the actual print, materials, and size availability.', 30000, 'Colour pop', 'photo-1551107696-a4b0c5a0d9a2'),
    ('Satin Evening Heel', 'Shoes', 'Slim heel · champagne', 'A dressy slim-heel style for celebrations and evening plans. Confirm heel height, material, and available sizes.', 48000, 'Occasion ready', 'photo-1539109136881-3be0616acf4b'),
    ('Platform Day Sandal', 'Shoes', 'Platform sandal · black', 'A platform sandal style for customers who want a little height with casual outfits. Verify platform height and fit.', 35500, 'Weekend lift', 'photo-1543163521-1bf539c55dd2'),
    ('Comfy House Slide', 'Shoes', 'Indoor slide · blush', 'A simple slide for relaxed indoor wear. Check the actual sole, material, and size range before listing.', 16000, 'At-home ease', 'photo-1560343090-f0409e92791a'),
    ('Pointed-Toe Work Flat', 'Shoes', 'Pointed flat · nude', 'A pointed-toe flat for a polished everyday look. Confirm the exact colour, material, size options, and fit.', 29500, 'Polished everyday', 'photo-1608231387042-66d1773070a5')
)
insert into public.products (name, category, detail, description, price, tag, image)
select
  seed.name,
  seed.category,
  seed.detail,
  seed.description,
  seed.price,
  seed.tag,
  seed.image
from seed_products as seed
where not exists (
  select 1
  from public.products as existing
  where lower(existing.name) = lower(seed.name)
    and existing.category = seed.category
);

commit;
