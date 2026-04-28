#!/bin/bash

# Deploy to Google Cloud Run
gcloud builds submit --tag gcr.io/$GOOGLE_CLOUD_PROJECT/ai-tutor-backend

gcloud run deploy ai-tutor-backend \
  --image gcr.io/$GOOGLE_CLOUD_PROJECT/ai-tutor-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT,WHATSAPP_VERIFY_TOKEN=$WHATSAPP_VERIFY_TOKEN,WHATSAPP_ACCESS_TOKEN=$WHATSAPP_ACCESS_TOKEN,WHATSAPP_PHONE_NUMBER_ID=$WHATSAPP_PHONE_NUMBER_ID"

echo "Deployment complete! Your URL:"
gcloud run services describe ai-tutor-backend --region us-central1 --format 'value(status.url)'