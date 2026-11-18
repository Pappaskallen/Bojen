# Onboarding av en pilotfirma

Tre saker att gå igenom med firman. Ordningen spelar roll, eftersom importen behöver marinorna
och numret behöver personalen.

1. **Marinor och personal.** Lägg in firmans marinor, klubbar och varv under Marinor, och
   personalen med mobilnummer. Kundlistan pekar på platserna med namn.
2. **Kundlistan.** Se *Importera kunder och båtar* nedan.
3. **Telefonnumret.** Se [nummerportering.md](nummerportering.md).
4. **Utbildningen.** Skicka videon. Manuset finns i
   [utbildningsvideo-manus.md](utbildningsvideo-manus.md).

## Importera kunder och båtar

Mallen är [importmall-kunder.xlsx](importmall-kunder.xlsx). Fliken *Instruktioner* förklarar
varje kolumn. Firman fyller i den, eller så klistrar vi in deras egen lista i den. En ny mall
skapas med:

```powershell
pnpm db:import mall importmall-kunder.xlsx
```

1. **Kontrollera listan.** Inget sparas i det här steget, och varje fel visas med radnummer:

   ```powershell
   pnpm db:import kunder --firma jonas-batservice kunder.xlsx
   ```

2. **Rätta i Excel och kör igen** tills det står *Listan går att spara*. Rader märkta *obs* är
   varningar, till exempel två rader med samma mobil men olika namn. De hindrar inte importen.
3. **Spara:**

   ```powershell
   pnpm db:import kunder --firma jonas-batservice kunder.xlsx --spara
   ```

   Allt sparas i en transaktion, så listan kommer in hel eller inte alls.
   - En kund vars mobil eller e-post redan finns i registret lämnas som den är. Samma lista går
     därför att köra två gånger.
   - Bojen räknar en kund som befintlig först när ett besök är utfört. Importerade kunder
     godkänns därför enligt firmans regler för nya kunder fram till sitt första besök i Bojen.

`DATABASE_URL` avgör vilken databas som används. Mot produktion: kör från en betrodd dator och
radera kundfilen när importen är klar. Den innehåller personuppgifter.

**Samtycke till erbjudanden:** sätt *ja* i kolumnen *Erbjudanden per sms* bara om firman kan
visa att kunden har sagt ja. Samtycket sparas med källan `import`. Påminnelser och kontroller
om bokningar skickas oavsett samtycke, eftersom de hör till tjänsten.
