-- CreateFunction
CREATE OR REPLACE FUNCTION check_offer_seats_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_seats INTEGER;
    v_accepted INTEGER;
BEGIN
    IF NEW."status" = 'ACCEPTED' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'ACCEPTED') THEN
        SELECT "seats" INTO v_seats
        FROM "offers"
        WHERE "id" = NEW."offerId"
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Oferta no encontrada con id: %', NEW."offerId";
        END IF;

        SELECT COUNT(*) INTO v_accepted
        FROM "applications"
        WHERE "offerId" = NEW."offerId"
          AND "status" = 'ACCEPTED'
          AND (TG_OP = 'INSERT' OR "id" <> NEW."id");

        IF v_accepted >= v_seats THEN
            RAISE EXCEPTION 'La oferta ya no tiene cupos disponibles (cupos: %, aceptados: %)', v_seats, v_accepted
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
DROP TRIGGER IF EXISTS trg_check_offer_seats ON "applications";
CREATE TRIGGER trg_check_offer_seats
BEFORE INSERT OR UPDATE OF status ON "applications"
FOR EACH ROW
EXECUTE FUNCTION check_offer_seats_guard();
