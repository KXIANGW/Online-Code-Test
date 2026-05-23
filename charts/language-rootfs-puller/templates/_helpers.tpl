{{/*
Common labels and naming helpers.
*/}}
{{- define "puller.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "puller.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "puller.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "puller.labels" -}}
app.kubernetes.io/name: {{ include "puller.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "puller.selectorLabels" -}}
app.kubernetes.io/name: {{ include "puller.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
