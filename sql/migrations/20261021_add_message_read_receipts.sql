-- MAVIKO: status pesan dibaca (read receipts)
-- Migration diterapkan pada proyek Supabase InfoKomunikasi.
-- Aman dijalankan ulang: kolom dibuat jika belum ada dan policy diganti dengan nama yang sama.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz NULL;

-- Batasi UPDATE dari klien hanya ke kolom read_at.
-- INSERT dan SELECT pesan yang sudah ada tidak diubah oleh perintah ini.
REVOKE UPDATE ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT UPDATE (read_at) ON TABLE public.messages TO authenticated;

DROP POLICY IF EXISTS "Recipients can mark messages as read" ON public.messages;
CREATE POLICY "Recipients can mark messages as read"
ON public.messages
FOR UPDATE
TO authenticated
USING (receiver_id = (SELECT auth.uid()))
WITH CHECK (receiver_id = (SELECT auth.uid()));
