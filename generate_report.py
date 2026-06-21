import sys
import subprocess
import os

def install_and_import():
    try:
        import docx
    except ImportError:
        print("Installing python-docx...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "python-docx"])
        import docx

    try:
        import markdown
    except ImportError:
        print("Installing markdown...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "markdown", "beautifulsoup4"])

install_and_import()

import docx
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from bs4 import BeautifulSoup
import markdown

# Load markdown content
markdown_text = """
# Fiche d'Avancement — Stage de Fin d'Études

**Étudiant :** Arhal Haytam  
**Projet :** Yool AI Plugin — Plateforme de résumé automatique de contenu éducatif  
**Date :** 20 mai 2026  
**Encadrant pédagogique :** Pr. Habib Ayad  

---

## 1. Travaux effectués

L'objectif principal de cette période a été la conception, le développement et la mise en place de l'architecture globale de la plateforme, incluant à la fois le back-end et le front-end. Le travail s'est focalisé sur la création d'un écosystème modulaire robuste, capable de traiter l'audio en temps réel et de l'analyser intelligemment.

L'architecture s'appuie désormais sur un ensemble de microservices conteneurisés (Docker), orchestrés derrière un reverse proxy (Nginx). Ces services incluent la gestion de l'authentification, le traitement des entités éducatives (cours, chapitres), l'ingestion et la transcription de l'audio (STT), ainsi que l'interfaçage avec les modèles d'intelligence artificielle pour la génération de résumés.

Du côté de l'interface utilisateur, une plateforme complète a été développée avec Next.js, offrant une séparation claire entre le panneau d'administration et l'espace réservé aux enseignants. L'accent a été mis sur l'ergonomie, la cohérence visuelle et l'expérience utilisateur, en adoptant un design moderne, fluide et professionnel.

## 2. Fonctionnalités et tâches finalisées

À ce stade du développement, les modules suivants sont pleinement opérationnels :

- **Système d'authentification sécurisé :** Implémentation complète de la connexion, gestion des sessions, et contrôle d'accès basé sur les rôles (Super Administrateur, Administrateur, Enseignant). Un système d'invitation par e-mail avec jetons à usage unique a également été finalisé.
- **Gestion de la hiérarchie curriculaire :** Développement du module permettant aux administrateurs de modéliser la structure éducative (Niveaux scolaires, Matières, Chapitres et Cours), garantissant une classification rigoureuse du contenu.
- **Pipeline de transcription audio (STT) :** Mise en production d'un service de traitement vocal capable d'enregistrer et de transcrire les séances en temps réel. Ce module intègre les modèles Whisper pour la reconnaissance vocale et PyAnnote pour la diarisation (identification distincte de la voix de l'enseignant et des étudiants).
- **Génération de résumés par Intelligence Artificielle :** Intégration du modèle Gemini 2.0 Flash pour analyser les transcriptions générées et produire un plan thématique structuré et détaillé de chaque séance.
- **Moteur de recherche sémantique :** Vectorisation des résumés générés pour permettre aux utilisateurs d'effectuer des recherches contextuelles en langage naturel, offrant des résultats pertinents basés sur le sens et non uniquement sur des mots-clés.

## 3. Difficultés éventuellement rencontrées

La mise en œuvre technique a soulevé quelques défis complexes qui ont nécessité un temps d'investigation supplémentaire :

- **Diarisation et gestion des ressources :** L'intégration de PyAnnote avec Whisper au sein d'un même environnement conteneurisé sans accélération matérielle (GPU) s'est avérée particulièrement complexe. L'optimisation de la charge en mémoire et la gestion du temps de démarrage (jusqu'à 15 minutes pour le chargement initial des modèles) ont demandé de nombreuses itérations pour assurer la stabilité du service.
- **Routage et sécurité des microservices :** La configuration avancée du reverse proxy Nginx a engendré des problèmes initiaux de type CORS lors de la communication entre le front-end et les nouveaux endpoints de l'API. Un diagnostic approfondi a été nécessaire pour normaliser les requêtes réseau et sécuriser les échanges.
- **Maintenabilité de l'interface (UI/UX) :** Le développement rapide de nouvelles fonctionnalités a entraîné un besoin de refactorisation fréquente du code CSS et des composants React, afin de prévenir les régressions visuelles et de garantir une conception réactive et harmonieuse sur l'ensemble de l'application.

## 4. Prochaines étapes prévues

Pour la suite du projet, les actions suivantes sont planifiées :

- **Tests d'intégration et validation en conditions réelles :** Effectuer des sessions d'enregistrement complètes pour évaluer la robustesse du pipeline de bout en bout (ingestion audio, transcription, génération du résumé et indexation sémantique).
- **Enrichissement de l'affichage des résultats de l'IA :** Transformer l'affichage actuel du résumé textuel en une interface visuellement structurée, mettant en évidence les mots-clés, les concepts principaux et les différents chapitres de manière interactive.
- **Documentation technique :** Rédiger un guide exhaustif de déploiement de l'architecture Docker et une documentation claire des API REST, afin de garantir la pérennité et la maintenabilité de la plateforme.

---

*Fiche rédigée le 20 mai 2026 — Arhal Haytam*
"""

html = markdown.markdown(markdown_text)
soup = BeautifulSoup(html, 'html.parser')

doc = docx.Document()

# Customize styles
style = doc.styles['Normal']
font = style.font
font.name = 'Calibri'
font.size = Pt(11)

heading_style = doc.styles['Heading 1']
heading_font = heading_style.font
heading_font.name = 'Calibri'
heading_font.size = Pt(16)
heading_font.color.rgb = RGBColor(0, 51, 102)

heading2_style = doc.styles['Heading 2']
heading2_font = heading2_style.font
heading2_font.name = 'Calibri'
heading2_font.size = Pt(14)
heading2_font.color.rgb = RGBColor(0, 51, 102)

heading3_style = doc.styles['Heading 3']
heading3_font = heading3_style.font
heading3_font.name = 'Calibri'
heading3_font.size = Pt(12)
heading3_font.bold = True
heading3_font.color.rgb = RGBColor(50, 50, 50)

def process_element(element, paragraph=None):
    if element.name == 'h1':
        doc.add_heading(element.text, level=1)
    elif element.name == 'h2':
        doc.add_heading(element.text, level=2)
    elif element.name == 'h3':
        doc.add_heading(element.text, level=3)
    elif element.name == 'p':
        p = doc.add_paragraph()
        for child in element.children:
            if child.name == 'strong' or child.name == 'b':
                p.add_run(child.text).bold = True
            elif child.name == 'em' or child.name == 'i':
                p.add_run(child.text).italic = True
            elif child.name is None:
                p.add_run(child)
    elif element.name == 'ul':
        for li in element.find_all('li', recursive=False):
            p = doc.add_paragraph(style='List Bullet')
            for child in li.children:
                if child.name == 'strong' or child.name == 'b':
                    p.add_run(child.text).bold = True
                elif child.name == 'em' or child.name == 'i':
                    p.add_run(child.text).italic = True
                elif child.name is None:
                    p.add_run(child)
    elif element.name == 'ol':
        for li in element.find_all('li', recursive=False):
            p = doc.add_paragraph(style='List Number')
            for child in li.children:
                if child.name == 'strong' or child.name == 'b':
                    p.add_run(child.text).bold = True
                elif child.name == 'em' or child.name == 'i':
                    p.add_run(child.text).italic = True
                elif child.name is None:
                    p.add_run(child)
    elif element.name == 'hr':
        p = doc.add_paragraph()
        p.add_run('_' * 40).font.color.rgb = RGBColor(180, 180, 180)

for element in soup.children:
    if element.name:
        process_element(element)

output_path = os.path.join(os.getcwd(), 'Fiche_Avancement_Stage.docx')
doc.save(output_path)
print(f"Word document successfully created at: {output_path}")
