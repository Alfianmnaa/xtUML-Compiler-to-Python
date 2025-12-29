from bridgepoint import oal
import xtuml

class OALToPyWalker(xtuml.Walker):
	def __init__(self, model_var_name="model"):
		super().__init__()
		self.buffer = []
		self.indent_level = 0
		self.model_var = model_var_name
    
	def get_py_code(self):
		return "".join(self.buffer)
	
	def add_line(self, line):
		self.buffer.append("	" * self.indent_level + line + "\n")

	def increase_indent(self):
		self.indent_level += 1

	def decrease_indent(self):
		self.indent_level = max(0, self.indent_level - 1)

	def accept_IntegerNode(self, node):
		value = int(node.value)
		return value
	
	def accept_ForEachNode(self, node, **kwargs):
		instance_var_name = node.instance_variable_name
		set_var_name = node.set_variable_name
		self.add_line(f"for {instance_var_name} in {set_var_name}:")
		self.increase_indent()
		self.accept(node.block, **kwargs)
		self.decrease_indent()

	def accept_WhileNode(self, node):
		expression = self.accept(node.expression)
		self.add_line(f"while {expression}:")
		self.increase_indent()
		self.accept(node.block)

	def accept_BreakNode(self, node):
		self.add_line(f"break")

	def accept_ContinueNode(self, node):
		self.add_line(f"continue")

	def accept_StatementListNode(self, node, **kwargs):
		for child in node.children:
			self.accept(child, **kwargs)

	def accept_BlockNode(self, node):
		statement_list = self.accept(node.statement_list)

	def accept_ElIfListNode(self, node, **kwargs):
		for child in node.children:
			self.accept(child, **kwargs)

	def accept_ElseNode(self, node):
		block = self.accept(node.block)

	def accept_IfNode(self, node, **kwargs):
		# Generate the condition
		condition = self.accept(node.expression, **kwargs)
		self.add_line(f"if {condition}:")
		self.increase_indent()
		self.accept(node.block, **kwargs)
		self.decrease_indent()

		# Handle elifs
		for elif_node in node.elif_list.children:
				elif_condition = self.accept(elif_node.expression, **kwargs)
				self.add_line(f"elif {elif_condition}:")
				self.increase_indent()
				self.accept(elif_node.block, **kwargs)
				self.decrease_indent()

		# Handle else
		if node.else_clause and node.else_clause.block:
				self.add_line("else:")
				self.increase_indent()
				self.accept(node.else_clause.block, **kwargs)
				self.decrease_indent()

	def accept_StringNode(self, node):
		value = node.value

		return value
	
	def accept_BooleanNode(self, node):
		value = node.value

		return value
	
	def accept_VariableAccessNode(self, node):
		var_name = node.variable_name

		return var_name

	def accept_SelectedAccessNode(self, node, **kwargs):
		return kwargs['iteration_var']

	def accept_FieldAccessNode(self, node, **kwargs):
		handle_code = self.accept(node.handle, **kwargs)
		attr_name = node.name
		
		return f"{handle_code}.{attr_name}"
	
	def accept_AssignmentNode(self, node):
		variable_access = self.accept(node.variable_access)
		expression = self.accept(node.expression)
		self.add_line(f"{variable_access} = {expression}")

	def accept_BinaryOperationNode(self, node, **kwargs):
		operator = node.operator
		left_operand = self.accept(node.left, **kwargs)
		right_operand = self.accept(node.right)

		return f"{left_operand} {operator} {right_operand}"

	def accept_CreateObjectNode(self, node):
		var_name = node.variable_name
		key_letter = node.key_letter

		print(f"{var_name} = {key_letter}()")

	def accept_DeleteNode(self, node):
		var_name = node.variable_name

		print(f"del {var_name}")

	def accept_SelectFromNode(self, node):
		cardinality = node.cardinality
		var_name = node.variable_name
		key_letter = node.key_letter

		if cardinality == 'many':
			self.add_line(f"{var_name} = {key_letter}.instances")
		else:
			self.add_line(f"{var_name} = next(iter({key_letter}.instances), None)")

	def accept_SelectFromWhereNode(self, node):
		cardinality = node.cardinality
		var_name = node.variable_name
		key_letter = node.key_letter
		iteration_var = 'item'
		where = self.accept(node.where_clause, iteration_var=iteration_var)

		if cardinality == 'many':
			self.add_line(f"{var_name} = [{iteration_var} for {iteration_var} in {key_letter}.instances if {where}]")
		else:
			self.add_line(f"{var_name} = next(({iteration_var} for {iteration_var} in {key_letter}.instances if {where}), None)")

## TEST TRANSLATOR ##
oal_code = """
create object instance d of DOG;
"""

ast = oal.parse(oal_code)
w = OALToPyWalker()
# w.visitors.append(xtuml.tools.NodePrintVisitor())
w.accept(ast)
print(w.get_py_code())