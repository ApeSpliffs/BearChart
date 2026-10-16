-- Rebrand: BearChart is now Plush Price Guide. Approved member photos carry the
-- site name in their credit line, so both the default and the rows already
-- approved under the old name follow it. Custom credits are left alone.

alter table item_photos
  alter column credit set default 'Photo by a Plush Price Guide member';

update item_photos
   set credit = 'Photo by a Plush Price Guide member'
 where credit = 'Photo by a BearChart member';
