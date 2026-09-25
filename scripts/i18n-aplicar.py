#!/usr/bin/env python3
"""
AquaTrip - ferramenta de apoio à tradução das views (uso de desenvolvimento).

Lê uma especificação JSON e:
  1. aplica substituições exatas ("raw") nas views/JS;
  2. troca textos em português ("t") por <%= t('chave') %> (ou <%- %> para _html),
     tolerando quebras de linha/indentação e exigindo borda de tag/aspas;
  3. grava/mescla as chaves em app/locales/{pt,en,es}/<area>.json.

Uso: python3 scripts/i18n-aplicar.py spec.json
Spec:
{
  "area": "descoberta",
  "arquivos": {
    "app/views/pages/index.ejs": {
      "raw": [["texto exato", "substituto"]],
      "t":   [["home.titulo", "Texto pt", "Text en", "Texto es"]],
      "attr": [["home.alt_foto", "Foto do mar", "Sea photo", "Foto del mar"]]
    }
  },
  "k": [["chave.extra", "pt", "en", "es"]]
}
"t"   : texto entre tags  -> <%= t('k') %>
"attr": valor de atributo  -> "<%= t('k') %>"  (procura "texto" entre aspas)
"""
import json, re, sys, os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def regex_texto(pt):
    partes = [re.escape(p) for p in pt.split()]
    return r"(?<=[>\s])" + r"\s+".join(partes) + r"(?=\s*<)"


def por(dic, chave, valor):
    atual = dic
    partes = chave.split(".")
    for p in partes[:-1]:
        atual = atual.setdefault(p, {})
    if partes[-1] in atual and atual[partes[-1]] != valor:
        raise SystemExit(f"chave {chave} já existe com outro valor")
    atual[partes[-1]] = valor


def main(caminho_spec):
    spec = json.load(open(caminho_spec, encoding="utf-8"))
    area = spec["area"]
    dic = {}
    for l in ("pt", "en", "es"):
        arq = os.path.join(RAIZ, "app/locales", l, area + ".json")
        dic[l] = json.load(open(arq, encoding="utf-8")) if os.path.exists(arq) else {}

    def definir(entrada):
        k, pt, en, es = entrada
        por(dic["pt"], k, pt); por(dic["en"], k, en); por(dic["es"], k, es)

    for arquivo, ops in spec.get("arquivos", {}).items():
        p = os.path.join(RAIZ, arquivo)
        s = open(p, encoding="utf-8").read()
        for find, rep in ops.get("raw", []):
            n = s.count(find)
            if n == 0:
                raise SystemExit(f"[{arquivo}] raw não encontrado: {find[:70]!r}")
            s = s.replace(find, rep)
        js = arquivo.endswith(".js")
        # mais longos primeiro, para não quebrar um texto maior que contém um menor
        for entrada in sorted(ops.get("t", []), key=lambda e: -len(e[1])):
            k = entrada[0]
            definir(entrada)
            eco = "<%-" if k.endswith("_html") else "<%="
            s2, n = re.subn(regex_texto(entrada[1]), f"{eco} t('{k}') %>", s)
            if n == 0:
                raise SystemExit(f"[{arquivo}] texto não encontrado: {entrada[1][:70]!r}")
            s = s2
        for entrada in ops.get("attr", []):
            k = entrada[0]
            definir(entrada)
            alvo = '"' + entrada[1] + '"'
            if alvo not in s:
                raise SystemExit(f"[{arquivo}] atributo não encontrado: {alvo[:70]!r}")
            s = s.replace(alvo, f"\"<%= t('{k}') %>\"")
        open(p, "w", encoding="utf-8").write(s)

    for entrada in spec.get("k", []):
        definir(entrada)

    for l in ("pt", "en", "es"):
        os.makedirs(os.path.join(RAIZ, "app/locales", l), exist_ok=True)
        arq = os.path.join(RAIZ, "app/locales", l, area + ".json")
        with open(arq, "w", encoding="utf-8") as f:
            json.dump(dic[l], f, ensure_ascii=False, indent=2)
            f.write("\n")
    print("ok:", area, sum(1 for _ in json.dumps(dic["pt"]).split('":')) - 1, "entradas aprox.")


if __name__ == "__main__":
    main(sys.argv[1])
