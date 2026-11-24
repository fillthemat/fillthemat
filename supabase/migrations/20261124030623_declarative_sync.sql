CREATE TRIGGER whatsapp_connection_secrets_set_updated_at
  BEFORE UPDATE ON public.whatsapp_connection_secrets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
