from flask import Flask, render_template, request, jsonify
import subprocess

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/execute_command', methods=['POST'])
def execute_command():
    command = request.form.get('command')
    try:
        result = subprocess.check_output(command, shell=True, stderr=subprocess.STDOUT, text=True)
        return jsonify({'output': result})
    except subprocess.CalledProcessError as e:
        return jsonify({'output': f"Error: {e.output}"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
